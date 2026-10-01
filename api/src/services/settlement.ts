import { keccak256, toHex } from "viem";
import { mapChainError } from "../chain/errors.js";
import type { MoharChain, TxResult } from "../chain/mohar-chain.js";
import type { Partner, QuoteRecord, TransactionRecord, WalletRecord } from "../domain/types.js";
import { newId } from "../lib/ids.js";
import type { SerialQueue } from "../lib/queue.js";
import type { Store } from "../store/store.js";
import type { MockVault } from "../vault/mock-vault.js";
import type { WebhookSender } from "./webhooks.js";

/** How long a vault receipt stays valid on-chain after it is signed. */
const ATTESTATION_TTL_SECONDS = 300n;

/**
 * Turns accepted requests into on-chain settlement. HTTP handlers call start*() and return
 * 202 immediately; the work runs on the relayer queue, one transaction at a time:
 *
 *   mint:     vault allocates + signs → token.mint → publish reserve → webhook
 *   burn:     vault signs → token.burn → vault de-allocates → publish reserve → webhook
 *   transfer: token.operatorTransfer → vault moves allocation → publish reserve → webhook
 */
export class SettlementService {
  constructor(
    private readonly chain: MoharChain,
    private readonly vault: MockVault,
    private readonly store: Store,
    private readonly queue: SerialQueue,
    private readonly webhooks: WebhookSender,
  ) {}

  startMint(partner: Partner, quote: QuoteRecord, wallet: WalletRecord): TransactionRecord {
    const txn = this.create(partner, "mint", wallet, BigInt(quote.grams), quote);
    const grams = BigInt(quote.grams);
    void this.queue.run(() =>
      this.settle(partner, txn, async (onSubmitted) => {
        const allocation = {
          wallet: wallet.address,
          grams,
          allocationRef: this.ref(txn.id),
          deadline: (await this.chain.latestBlockTimestamp()) + ATTESTATION_TTL_SECONDS,
        };
        this.vault.allocate(wallet.address, grams); // counts from signing (accounting rule)
        try {
          const signature = await this.vault.signAllocation(allocation);
          return await this.chain.mint(allocation, BigInt(quote.xauUsdE8), signature, onSubmitted);
        } catch (error) {
          this.vault.releaseAllocation(wallet.address, grams);
          throw error;
        }
      }),
    );
    return txn;
  }

  startBurn(partner: Partner, quote: QuoteRecord, wallet: WalletRecord): TransactionRecord {
    const txn = this.create(partner, "burn", wallet, BigInt(quote.grams), quote);
    const grams = BigInt(quote.grams);
    void this.queue.run(() =>
      this.settle(partner, txn, async (onSubmitted) => {
        const deallocation = {
          wallet: wallet.address,
          grams,
          deallocationRef: this.ref(txn.id),
          deadline: (await this.chain.latestBlockTimestamp()) + ATTESTATION_TTL_SECONDS,
        };
        const signature = await this.vault.signDeallocation(deallocation);
        const result = await this.chain.burn(
          deallocation,
          BigInt(quote.xauUsdE8),
          signature,
          onSubmitted,
        );
        this.vault.deallocate(wallet.address, grams); // only after the burn confirmed
        return result;
      }),
    );
    return txn;
  }

  startTransfer(
    partner: Partner,
    from: WalletRecord,
    to: WalletRecord,
    grams: bigint,
  ): TransactionRecord {
    const txn = this.create(partner, "transfer", from, grams, undefined, to);
    void this.queue.run(() =>
      this.settle(partner, txn, async (onSubmitted) => {
        const result = await this.chain.operatorTransfer(
          from.address,
          to.address,
          grams,
          onSubmitted,
        );
        this.vault.move(from.address, to.address, grams);
        return result;
      }),
    );
    return txn;
  }

  /** Signs and publishes the vault's current book to the ReserveRegistry. Call on the queue. */
  async publishReserve(): Promise<TxResult> {
    const attestation = this.vault.nextAttestation(await this.chain.latestBlockTimestamp());
    const signature = await this.vault.signReserve(attestation);
    return this.chain.publishReserve(attestation, signature);
  }

  /** Waits for all queued settlement work (tests, graceful shutdown). */
  idle(): Promise<void> {
    return this.queue.idle();
  }

  // ---------------------------------------------------------------- internal

  private create(
    partner: Partner,
    type: TransactionRecord["type"],
    wallet: WalletRecord,
    grams: bigint,
    quote?: QuoteRecord,
    counterparty?: WalletRecord,
  ): TransactionRecord {
    const txn: TransactionRecord = {
      id: newId("txn"),
      partnerSlug: partner.slug,
      type,
      status: "pending",
      walletId: wallet.id,
      grams: grams.toString(),
      createdAt: new Date().toISOString(),
      ...(quote ? { quoteId: quote.id, netPaisa: quote.netPaisa } : {}),
      ...(counterparty ? { counterpartyWalletId: counterparty.id } : {}),
    };
    this.store.saveTransaction(txn);
    return txn;
  }

  private async settle(
    partner: Partner,
    txn: TransactionRecord,
    work: (onSubmitted: (hash: `0x${string}`) => void) => Promise<TxResult>,
  ): Promise<void> {
    try {
      const result = await work((hash) => {
        this.store.updateTransaction(txn.id, { status: "submitted", txHash: hash });
      });
      const confirmed = this.store.updateTransaction(txn.id, {
        status: "confirmed",
        txHash: result.hash,
        blockNumber: Number(result.blockNumber),
        confirmedAt: new Date().toISOString(),
      });
      await this.publishReserveSafely();
      this.webhooks.send(partner, "transaction.confirmed", confirmed);
    } catch (error) {
      const failure = mapChainError(error);
      console.warn(`Settlement ${txn.id} failed: ${failure.revert ?? failure.message}`);
      const failed = this.store.updateTransaction(txn.id, {
        status: "failed",
        failureCode: failure.code,
        failureMessage: failure.message,
      });
      this.webhooks.send(partner, "transaction.failed", failed);
    }
  }

  private async publishReserveSafely(): Promise<void> {
    try {
      await this.publishReserve();
    } catch (error) {
      console.error("Reserve publish failed:", mapChainError(error).message);
    }
  }

  /** Deterministic vault reference for a transaction id. */
  private ref(transactionId: string): `0x${string}` {
    return keccak256(toHex(`MOHAR:${this.chain.chainId}:${transactionId}`));
  }
}
