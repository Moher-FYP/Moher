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

/** What recover() did with the trades the previous run left unfinished. */
export interface RecoverySummary {
  confirmed: number;
  failed: number;
  /** Sent, but still without a receipt: left as "submitted" for the next start to check. */
  stillWaiting: number;
}

/**
 * Turns accepted requests into on-chain settlement. HTTP handlers call start*() and return
 * 202 immediately; the work runs on the relayer queue, one transaction at a time:
 *
 *   mint:     vault allocates + signs → token.mint → webhook
 *   burn:     vault signs → token.burn → vault de-allocates → webhook
 *   transfer: token.operatorTransfer → vault moves allocation → webhook
 *
 * Each trade then asks for a reserve proof. Requests are combined: one proof is published after
 * the trades already waiting have settled, and at most once per `reserveIntervalSeconds`. Under
 * load (or with an interval) one proof covers many trades, which roughly halves the gas of a
 * trade; with no queue and no interval it is still one proof per trade, as before.
 */
export class SettlementService {
  constructor(
    private readonly chain: MoharChain,
    private readonly vault: MockVault,
    private readonly store: Store,
    private readonly queue: SerialQueue,
    private readonly webhooks: WebhookSender,
    /** Least time between two reserve proofs. 0: publish as soon as the queue allows. */
    private readonly reserveIntervalSeconds = 0,
  ) {}

  private reserveRequested = false;
  private lastReserveAt = 0;
  private reserveTimer: NodeJS.Timeout | undefined;

  /**
   * Asks for a reserve proof covering every trade settled so far. Several requests before the
   * proof goes out become one proof. Safe to call from inside queued work: the proof is queued
   * behind the trades already waiting.
   */
  requestReserve(): void {
    if (this.reserveRequested) return;
    this.reserveRequested = true;
    const publish = () =>
      void this.queue.run(async () => {
        this.reserveRequested = false;
        this.lastReserveAt = Date.now();
        await this.publishReserveSafely();
      });
    const wait = this.lastReserveAt + this.reserveIntervalSeconds * 1000 - Date.now();
    if (wait <= 0) {
      publish();
    } else {
      this.reserveTimer = setTimeout(publish, wait);
      this.reserveTimer.unref();
    }
  }

  /** Stops a waiting reserve timer (shutdown, tests). */
  stop(): void {
    if (this.reserveTimer) clearTimeout(this.reserveTimer);
  }

  startMint(partner: Partner, quote: QuoteRecord, wallet: WalletRecord): TransactionRecord {
    const txn = this.create(partner, "mint", wallet, BigInt(quote.grams), quote);
    const grams = BigInt(quote.grams);
    void this.queue.run(() =>
      this.settle(partner, txn, async (onSubmitted) => {
        const allocation = {
          wallet: wallet.address,
          grams,
          allocationRef: this.ref(txn.id),
          deadline: await this.receiptDeadline(),
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
          deadline: await this.receiptDeadline(),
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
    valuePaisa: bigint,
  ): TransactionRecord {
    const txn = this.create(partner, "transfer", from, grams, undefined, to, valuePaisa);
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

  /**
   * After a restart, finishes the trades the previous run left unfinished. The work queue lives
   * in memory, so without this a trade caught mid-flight would stay "pending" forever.
   *
   *   never sent (no hash)   → failed. Nothing reached the chain; the partner requotes.
   *   sent, receipt found    → confirmed or failed, as the chain says.
   *   sent, no receipt yet   → left alone. It may still be mined, so calling it failed could
   *                            be wrong; the next start checks again.
   *
   * Partners get the usual webhook for every trade this settles. Call before serving requests.
   */
  async recover(
    partnerOf: (slug: string) => Partner | undefined,
    waitMs = 60_000,
  ): Promise<RecoverySummary> {
    const summary: RecoverySummary = { confirmed: 0, failed: 0, stillWaiting: 0 };
    for (const txn of this.store.unfinishedTransactions()) {
      const partner = partnerOf(txn.partnerSlug);
      if (!txn.txHash) {
        const failed = this.store.updateTransaction(txn.id, {
          status: "failed",
          failureCode: "internal_error",
          failureMessage:
            "Interrupted by a restart before it was sent. Nothing happened on-chain. Request a new quote.",
        });
        summary.failed++;
        if (partner) this.webhooks.send(partner, "transaction.failed", failed);
        continue;
      }
      const outcome = await this.chain.waitForOutcome(txn.txHash, waitMs);
      if (!outcome) {
        console.warn(`Transaction ${txn.id} (${txn.txHash}) has no receipt yet; left as submitted`);
        summary.stillWaiting++;
      } else if (outcome.succeeded) {
        const confirmed = this.store.updateTransaction(txn.id, {
          status: "confirmed",
          blockNumber: Number(outcome.blockNumber),
          confirmedAt: new Date().toISOString(),
        });
        summary.confirmed++;
        if (partner) this.webhooks.send(partner, "transaction.confirmed", confirmed);
      } else {
        const failed = this.store.updateTransaction(txn.id, {
          status: "failed",
          failureCode: "internal_error",
          failureMessage: "The transaction reverted on-chain.",
        });
        summary.failed++;
        if (partner) this.webhooks.send(partner, "transaction.failed", failed);
      }
    }
    return summary;
  }

  /** Waits for all queued settlement work (tests, graceful shutdown). */
  idle(): Promise<void> {
    return this.queue.idle();
  }

  // ---------------------------------------------------------------- internal

  /**
   * When the vault's signed receipt stops being valid. Counted from the later of the last
   * block and the clock: a local chain mines only when a transaction arrives, so after a quiet
   * spell its last block is old, and a deadline counted from it would already have passed.
   */
  private async receiptDeadline(): Promise<bigint> {
    const block = await this.chain.latestBlockTimestamp();
    const now = BigInt(Math.floor(Date.now() / 1000));
    return (block > now ? block : now) + ATTESTATION_TTL_SECONDS;
  }

  private create(
    partner: Partner,
    type: TransactionRecord["type"],
    wallet: WalletRecord,
    grams: bigint,
    quote?: QuoteRecord,
    counterparty?: WalletRecord,
    valuePaisa?: bigint,
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
      ...(valuePaisa !== undefined ? { valuePaisa: valuePaisa.toString() } : {}),
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
      this.requestReserve();
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
