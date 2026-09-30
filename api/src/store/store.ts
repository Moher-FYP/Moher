import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type {
  IdempotencyRecord,
  QuoteRecord,
  TransactionRecord,
  WalletRecord,
} from "../domain/types.js";

interface State {
  /** Identifies the chain this data belongs to; a fresh Anvil chain gets a fresh store. */
  chainMarker: string;
  nextDerivationIndex: number;
  wallets: Record<string, WalletRecord>;
  quotes: Record<string, QuoteRecord>;
  transactions: Record<string, TransactionRecord>;
  idempotency: Record<string, IdempotencyRecord>;
}

const emptyState = (chainMarker: string): State => ({
  chainMarker,
  nextDerivationIndex: 0,
  wallets: {},
  quotes: {},
  transactions: {},
  idempotency: {},
});

/**
 * Small write-through JSON store. Enough for the FYP demo (one API process, thousands of
 * records); swap for Postgres behind the same methods before any real deployment.
 * Pass `null` as the path to keep everything in memory (tests).
 */
export class Store {
  private state: State = emptyState("");

  constructor(private readonly filePath: string | null) {}

  /** Loads the file; starts empty if it is missing or belongs to a different chain. */
  open(chainMarker: string): { reset: boolean } {
    if (this.filePath) {
      try {
        const loaded = JSON.parse(readFileSync(this.filePath, "utf8")) as State;
        if (loaded.chainMarker === chainMarker) {
          this.state = loaded;
          return { reset: false };
        }
      } catch {
        // no file yet
      }
    }
    this.state = emptyState(chainMarker);
    this.persist();
    return { reset: true };
  }

  // ---------------------------------------------------------------- wallets

  nextDerivationIndex(): number {
    const index = this.state.nextDerivationIndex;
    this.state.nextDerivationIndex += 1;
    this.persist();
    return index;
  }

  saveWallet(wallet: WalletRecord): void {
    this.state.wallets[wallet.id] = wallet;
    this.persist();
  }

  getWallet(id: string): WalletRecord | undefined {
    return this.state.wallets[id];
  }

  findWalletByCustomer(partnerSlug: string, externalCustomerId: string): WalletRecord | undefined {
    return Object.values(this.state.wallets).find(
      (w) => w.partnerSlug === partnerSlug && w.externalCustomerId === externalCustomerId,
    );
  }

  allWallets(): WalletRecord[] {
    return Object.values(this.state.wallets);
  }

  // ---------------------------------------------------------------- quotes

  saveQuote(quote: QuoteRecord): void {
    this.state.quotes[quote.id] = quote;
    this.persist();
  }

  getQuote(id: string): QuoteRecord | undefined {
    return this.state.quotes[id];
  }

  // ---------------------------------------------------------------- transactions

  saveTransaction(txn: TransactionRecord): void {
    this.state.transactions[txn.id] = txn;
    this.persist();
  }

  updateTransaction(id: string, patch: Partial<TransactionRecord>): TransactionRecord {
    const existing = this.state.transactions[id];
    if (!existing) throw new Error(`Unknown transaction ${id}`);
    const updated = { ...existing, ...patch };
    this.state.transactions[id] = updated;
    this.persist();
    return updated;
  }

  getTransaction(id: string): TransactionRecord | undefined {
    return this.state.transactions[id];
  }

  /** Newest first. The cursor is the id of the last item of the previous page. */
  listTransactions(
    partnerSlug: string,
    options: { walletId?: string; limit: number; cursor?: string },
  ): { data: TransactionRecord[]; nextCursor?: string } {
    const all = Object.values(this.state.transactions)
      .filter(
        (t) =>
          t.partnerSlug === partnerSlug &&
          (!options.walletId ||
            t.walletId === options.walletId ||
            t.counterpartyWalletId === options.walletId),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
    const start = options.cursor ? all.findIndex((t) => t.id === options.cursor) + 1 : 0;
    const data = all.slice(start, start + options.limit);
    const last = data.at(-1);
    return {
      data,
      nextCursor: last && start + options.limit < all.length ? last.id : undefined,
    };
  }

  // ---------------------------------------------------------------- idempotency

  getIdempotency(key: string): IdempotencyRecord | undefined {
    return this.state.idempotency[key];
  }

  saveIdempotency(key: string, record: IdempotencyRecord): void {
    this.state.idempotency[key] = record;
    this.persist();
  }

  deleteIdempotency(key: string): void {
    delete this.state.idempotency[key];
    this.persist();
  }

  // ---------------------------------------------------------------- persistence

  private persist(): void {
    if (!this.filePath) return;
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    renameSync(tmp, this.filePath);
  }
}
