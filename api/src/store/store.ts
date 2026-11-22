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

  /** One partner's wallets, newest first. */
  walletsOf(partnerSlug: string): WalletRecord[] {
    return Object.values(this.state.wallets)
      .filter((w) => w.partnerSlug === partnerSlug)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  }

  // ---------------------------------------------------------------- quotes

  saveQuote(quote: QuoteRecord): void {
    this.state.quotes[quote.id] = quote;
    this.persist();
  }

  getQuote(id: string): QuoteRecord | undefined {
    return this.state.quotes[id];
  }

  /** One partner's quotes, oldest first. */
  quotesOf(partnerSlug: string): QuoteRecord[] {
    return Object.values(this.state.quotes)
      .filter((q) => q.partnerSlug === partnerSlug)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }

  /** Every partner's quotes, oldest first: the record of prices over time. */
  allQuotes(): QuoteRecord[] {
    return Object.values(this.state.quotes).sort(
      (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    );
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

  /** Every partner's transactions, unordered. A transfer between partners is in one list only. */
  allTransactions(): TransactionRecord[] {
    return Object.values(this.state.transactions);
  }

  /** One partner's transactions, newest first. */
  transactionsOf(partnerSlug: string): TransactionRecord[] {
    return Object.values(this.state.transactions)
      .filter((t) => t.partnerSlug === partnerSlug)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  }

  /**
   * Rupees credited to a wallet since a time: its purchases, and gold sent to it valued when it
   * was sent. Pending and confirmed count; failed never happened. KYC limits are on money in,
   * as the State Bank's account limits are, so buying in one wallet and passing the gold to
   * another cannot get round the receiver's limit.
   */
  creditedSince(walletId: string, sinceIso: string): bigint {
    return Object.values(this.state.transactions)
      .filter((t) => t.status !== "failed" && t.createdAt >= sinceIso)
      .reduce((sum, t) => {
        if (t.type === "mint" && t.walletId === walletId) return sum + BigInt(t.netPaisa ?? "0");
        if (t.type === "transfer" && t.counterpartyWalletId === walletId) {
          return sum + BigInt(t.valuePaisa ?? "0");
        }
        return sum;
      }, 0n);
  }

  /** Transactions that never reached confirmed or failed, oldest first. */
  unfinishedTransactions(): TransactionRecord[] {
    return Object.values(this.state.transactions)
      .filter((t) => t.status === "pending" || t.status === "submitted")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  // ---------------------------------------------------------------- idempotency

  getIdempotency(key: string): IdempotencyRecord | undefined {
    return this.state.idempotency[key];
  }

  saveIdempotency(key: string, record: IdempotencyRecord): void {
    this.state.idempotency[key] = record;
    this.persist();
  }

  /**
   * Forgets requests that were still running when the process stopped, so the client's retry
   * with the same Idempotency-Key runs instead of answering "still running" forever.
   */
  clearInProgressIdempotency(): number {
    const stuck = Object.entries(this.state.idempotency).filter(([, r]) => r.inProgress);
    for (const [key] of stuck) delete this.state.idempotency[key];
    if (stuck.length > 0) this.persist();
    return stuck.length;
  }

  deleteIdempotency(key: string): void {
    delete this.state.idempotency[key];
    this.persist();
  }

  // ---------------------------------------------------------------- simulated history

  /**
   * Adds the history simulator's records (src/sim). Refuses a partner that has any real record,
   * so simulated and real figures can never mix in one partner's analytics, and refuses any id
   * or wallet address already in use, so a simulated record can never replace a real one. All
   * checks run before anything is written: the store is changed in full or not at all.
   */
  addSimulated(records: {
    wallets: WalletRecord[];
    quotes: QuoteRecord[];
    transactions: TransactionRecord[];
  }): void {
    const partners = new Set(
      [...records.wallets, ...records.quotes, ...records.transactions].map((r) => r.partnerSlug),
    );
    for (const record of [...records.wallets, ...records.quotes, ...records.transactions]) {
      if (!record.simulated) throw new Error(`Record ${record.id} is not marked simulated`);
    }
    const real = [
      ...Object.values(this.state.wallets),
      ...Object.values(this.state.quotes),
      ...Object.values(this.state.transactions),
    ].find((r) => partners.has(r.partnerSlug) && !r.simulated);
    if (real) {
      throw new Error(
        `Partner "${real.partnerSlug}" already has real records (${real.id}); simulate into a partner of its own`,
      );
    }
    const clash = (
      kind: string,
      batch: { id: string }[],
      existing: Record<string, unknown>,
    ): void => {
      const seen = new Set<string>();
      for (const { id } of batch) {
        if (id in existing || seen.has(id))
          throw new Error(`The ${kind} id ${id} is already in use`);
        seen.add(id);
      }
    };
    clash("wallet", records.wallets, this.state.wallets);
    clash("quote", records.quotes, this.state.quotes);
    clash("transaction", records.transactions, this.state.transactions);
    const addresses = new Set(
      Object.values(this.state.wallets).map((w) => w.address.toLowerCase()),
    );
    for (const w of records.wallets) {
      const address = w.address.toLowerCase();
      if (addresses.has(address))
        throw new Error(`The wallet address ${w.address} is already in use`);
      addresses.add(address);
    }
    for (const w of records.wallets) this.state.wallets[w.id] = w;
    for (const q of records.quotes) this.state.quotes[q.id] = q;
    for (const t of records.transactions) this.state.transactions[t.id] = t;
    this.persist();
  }

  /** Removes a partner's simulated records (to simulate again). Real records are never touched. */
  clearSimulated(partnerSlug: string): number {
    let removed = 0;
    for (const bucket of [this.state.wallets, this.state.quotes, this.state.transactions]) {
      for (const [id, record] of Object.entries(bucket)) {
        if (record.partnerSlug === partnerSlug && record.simulated) {
          delete bucket[id];
          removed += 1;
        }
      }
    }
    if (removed > 0) this.persist();
    return removed;
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
