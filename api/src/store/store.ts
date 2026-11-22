import { existsSync, readFileSync, renameSync } from "node:fs";
import type {
  IdempotencyRecord,
  QuoteRecord,
  TransactionRecord,
  WalletRecord,
} from "../domain/types.js";
import { col, openDatabase, record, records, transaction, type Database } from "./sqlite.js";

/**
 * Wallets, quotes, transactions and idempotency records, in SQLite (store/sqlite.ts says why).
 * One database per chain (`store-<chainId>.db`); a fresh Anvil chain empties it. Pass `null`
 * as the path for an in-memory database (tests).
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS wallets (
  id                   TEXT PRIMARY KEY,
  partner_slug         TEXT NOT NULL,
  external_customer_id TEXT NOT NULL,
  address              TEXT NOT NULL,
  created_at           TEXT NOT NULL,
  simulated            INTEGER NOT NULL DEFAULT 0,
  data                 TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS wallets_customer ON wallets (partner_slug, external_customer_id);
CREATE UNIQUE INDEX IF NOT EXISTS wallets_address ON wallets (lower(address));
CREATE TABLE IF NOT EXISTS quotes (
  id           TEXT PRIMARY KEY,
  partner_slug TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  simulated    INTEGER NOT NULL DEFAULT 0,
  data         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS quotes_partner ON quotes (partner_slug, created_at);
CREATE TABLE IF NOT EXISTS transactions (
  id                     TEXT PRIMARY KEY,
  partner_slug           TEXT NOT NULL,
  type                   TEXT NOT NULL,
  status                 TEXT NOT NULL,
  wallet_id              TEXT NOT NULL,
  counterparty_wallet_id TEXT,
  created_at             TEXT NOT NULL,
  simulated              INTEGER NOT NULL DEFAULT 0,
  data                   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS transactions_partner ON transactions (partner_slug, created_at, id);
CREATE INDEX IF NOT EXISTS transactions_wallet ON transactions (wallet_id);
CREATE INDEX IF NOT EXISTS transactions_counterparty ON transactions (counterparty_wallet_id);
CREATE INDEX IF NOT EXISTS transactions_status ON transactions (status);
CREATE TABLE IF NOT EXISTS idempotency (
  key         TEXT PRIMARY KEY,
  in_progress INTEGER NOT NULL,
  data        TEXT NOT NULL
);
`;

/** The JSON file this store replaced (`store-<chainId>.json`), imported once if it is found. */
interface LegacyState {
  chainMarker: string;
  nextDerivationIndex: number;
  wallets: Record<string, WalletRecord>;
  quotes: Record<string, QuoteRecord>;
  transactions: Record<string, TransactionRecord>;
  idempotency: Record<string, IdempotencyRecord>;
}

const NEWEST_FIRST = "ORDER BY created_at DESC, id DESC";
const OLDEST_FIRST = "ORDER BY created_at ASC, id ASC";

export class Store {
  private readonly db: Database;

  /** `legacyJsonPath`: the old JSON store, imported into an empty database on `open`. */
  constructor(
    path: string | null,
    private readonly legacyJsonPath?: string,
  ) {
    this.db = openDatabase(path);
    this.db.exec(SCHEMA);
  }

  /** Starts empty if the database belongs to a different chain (a restarted Anvil). */
  open(chainMarker: string): { reset: boolean; imported?: number } {
    return transaction(this.db, () => {
      const current = this.meta("chainMarker");
      if (current === chainMarker) return { reset: false };
      const imported = current === undefined ? this.importLegacy(chainMarker) : undefined;
      if (imported !== undefined) return { reset: false, imported };
      for (const table of ["wallets", "quotes", "transactions", "idempotency", "meta"]) {
        this.db.exec(`DELETE FROM ${table}`);
      }
      this.setMeta("chainMarker", chainMarker);
      this.setMeta("nextDerivationIndex", "0");
      return { reset: true };
    });
  }

  /** Closes the database file (CLIs, before they exit). */
  close(): void {
    this.db.close();
  }

  // ---------------------------------------------------------------- wallets

  /** The next HD derivation index for a custodial wallet. Never hands out the same one twice. */
  nextDerivationIndex(): number {
    return transaction(this.db, () => {
      const index = Number(this.meta("nextDerivationIndex") ?? "0");
      this.setMeta("nextDerivationIndex", String(index + 1));
      return index;
    });
  }

  saveWallet(wallet: WalletRecord): void {
    this.db
      .prepare(
        `INSERT INTO wallets (id, partner_slug, external_customer_id, address, created_at, simulated, data)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET partner_slug = excluded.partner_slug,
           external_customer_id = excluded.external_customer_id, address = excluded.address,
           created_at = excluded.created_at, simulated = excluded.simulated, data = excluded.data`,
      )
      .run(
        wallet.id,
        wallet.partnerSlug,
        wallet.externalCustomerId,
        wallet.address,
        wallet.createdAt,
        col(wallet.simulated === true),
        JSON.stringify(wallet),
      );
  }

  getWallet(id: string): WalletRecord | undefined {
    return record(this.db.prepare("SELECT data FROM wallets WHERE id = ?").get(id));
  }

  findWalletByCustomer(partnerSlug: string, externalCustomerId: string): WalletRecord | undefined {
    return record(
      this.db
        .prepare("SELECT data FROM wallets WHERE partner_slug = ? AND external_customer_id = ?")
        .get(partnerSlug, externalCustomerId),
    );
  }

  allWallets(): WalletRecord[] {
    return records(this.db.prepare("SELECT data FROM wallets ORDER BY rowid").all());
  }

  /** One partner's wallets, newest first. */
  walletsOf(partnerSlug: string): WalletRecord[] {
    return records(
      this.db
        .prepare(`SELECT data FROM wallets WHERE partner_slug = ? ${NEWEST_FIRST}`)
        .all(partnerSlug),
    );
  }

  // ---------------------------------------------------------------- quotes

  saveQuote(quote: QuoteRecord): void {
    this.db
      .prepare(
        `INSERT INTO quotes (id, partner_slug, created_at, simulated, data) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET partner_slug = excluded.partner_slug,
           created_at = excluded.created_at, simulated = excluded.simulated, data = excluded.data`,
      )
      .run(
        quote.id,
        quote.partnerSlug,
        quote.createdAt,
        col(quote.simulated === true),
        JSON.stringify(quote),
      );
  }

  getQuote(id: string): QuoteRecord | undefined {
    return record(this.db.prepare("SELECT data FROM quotes WHERE id = ?").get(id));
  }

  /** One partner's quotes, oldest first. */
  quotesOf(partnerSlug: string): QuoteRecord[] {
    return records(
      this.db
        .prepare(`SELECT data FROM quotes WHERE partner_slug = ? ${OLDEST_FIRST}`)
        .all(partnerSlug),
    );
  }

  /** Every partner's quotes, oldest first: the record of prices over time. */
  allQuotes(): QuoteRecord[] {
    return records(this.db.prepare(`SELECT data FROM quotes ${OLDEST_FIRST}`).all());
  }

  // ---------------------------------------------------------------- transactions

  saveTransaction(txn: TransactionRecord): void {
    this.db
      .prepare(
        `INSERT INTO transactions
           (id, partner_slug, type, status, wallet_id, counterparty_wallet_id, created_at, simulated, data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET partner_slug = excluded.partner_slug, type = excluded.type,
           status = excluded.status, wallet_id = excluded.wallet_id,
           counterparty_wallet_id = excluded.counterparty_wallet_id,
           created_at = excluded.created_at, simulated = excluded.simulated, data = excluded.data`,
      )
      .run(
        txn.id,
        txn.partnerSlug,
        txn.type,
        txn.status,
        txn.walletId,
        col(txn.counterpartyWalletId),
        txn.createdAt,
        col(txn.simulated === true),
        JSON.stringify(txn),
      );
  }

  updateTransaction(id: string, patch: Partial<TransactionRecord>): TransactionRecord {
    return transaction(this.db, () => {
      const existing = this.getTransaction(id);
      if (!existing) throw new Error(`Unknown transaction ${id}`);
      const updated = { ...existing, ...patch };
      this.saveTransaction(updated);
      return updated;
    });
  }

  getTransaction(id: string): TransactionRecord | undefined {
    return record(this.db.prepare("SELECT data FROM transactions WHERE id = ?").get(id));
  }

  /** Newest first. The cursor is the id of the last item of the previous page. */
  listTransactions(
    partnerSlug: string,
    options: { walletId?: string; limit: number; cursor?: string },
  ): { data: TransactionRecord[]; nextCursor?: string } {
    const where = ["partner_slug = ?"];
    const params: (string | number)[] = [partnerSlug];
    if (options.walletId) {
      where.push("(wallet_id = ? OR counterparty_wallet_id = ?)");
      params.push(options.walletId, options.walletId);
    }
    const after = options.cursor
      ? this.db.prepare("SELECT created_at, id FROM transactions WHERE id = ?").get(options.cursor)
      : undefined;
    if (after) {
      // Keyset pagination: rows that sort after the cursor's row in newest-first order.
      where.push("(created_at, id) < (?, ?)");
      params.push(after.created_at as string, after.id as string);
    }
    // One extra row says whether there is another page.
    const rows = records<TransactionRecord>(
      this.db
        .prepare(
          `SELECT data FROM transactions WHERE ${where.join(" AND ")} ${NEWEST_FIRST} LIMIT ?`,
        )
        .all(...params, options.limit + 1),
    );
    const data = rows.slice(0, options.limit);
    return {
      data,
      nextCursor: rows.length > options.limit ? data.at(-1)?.id : undefined,
    };
  }

  /** Every partner's transactions. A transfer between partners is in one list only. */
  allTransactions(): TransactionRecord[] {
    return records(this.db.prepare("SELECT data FROM transactions ORDER BY rowid").all());
  }

  /** One partner's transactions, newest first. */
  transactionsOf(partnerSlug: string): TransactionRecord[] {
    return records(
      this.db
        .prepare(`SELECT data FROM transactions WHERE partner_slug = ? ${NEWEST_FIRST}`)
        .all(partnerSlug),
    );
  }

  /**
   * Rupees credited to a wallet since a time: its purchases, and gold sent to it valued when it
   * was sent. Pending and confirmed count; failed never happened. KYC limits are on money in,
   * as the State Bank's account limits are, so buying in one wallet and passing the gold to
   * another cannot get round the receiver's limit.
   */
  creditedSince(walletId: string, sinceIso: string): bigint {
    const rows = records<TransactionRecord>(
      this.db
        .prepare(
          `SELECT data FROM transactions
           WHERE status != 'failed' AND created_at >= ?
             AND ((type = 'mint' AND wallet_id = ?) OR (type = 'transfer' AND counterparty_wallet_id = ?))`,
        )
        .all(sinceIso, walletId, walletId),
    );
    // Summed as bigint here: amounts are exact decimal strings, never SQL floats.
    return rows.reduce(
      (sum, t) => sum + BigInt((t.type === "mint" ? t.netPaisa : t.valuePaisa) ?? "0"),
      0n,
    );
  }

  /** Transactions that never reached confirmed or failed, oldest first. */
  unfinishedTransactions(): TransactionRecord[] {
    return records(
      this.db
        .prepare(
          `SELECT data FROM transactions WHERE status IN ('pending', 'submitted') ${OLDEST_FIRST}`,
        )
        .all(),
    );
  }

  // ---------------------------------------------------------------- idempotency

  getIdempotency(key: string): IdempotencyRecord | undefined {
    return record(this.db.prepare("SELECT data FROM idempotency WHERE key = ?").get(key));
  }

  saveIdempotency(key: string, entry: IdempotencyRecord): void {
    this.db
      .prepare(
        `INSERT INTO idempotency (key, in_progress, data) VALUES (?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET in_progress = excluded.in_progress, data = excluded.data`,
      )
      .run(key, col(entry.inProgress === true), JSON.stringify(entry));
  }

  /**
   * Forgets requests that were still running when the process stopped, so the client's retry
   * with the same Idempotency-Key runs instead of answering "still running" forever.
   */
  clearInProgressIdempotency(): number {
    return Number(this.db.prepare("DELETE FROM idempotency WHERE in_progress = 1").run().changes);
  }

  deleteIdempotency(key: string): void {
    this.db.prepare("DELETE FROM idempotency WHERE key = ?").run(key);
  }

  // ---------------------------------------------------------------- simulated history

  /**
   * Adds the history simulator's records (src/sim). Refuses a partner that has any real record,
   * so simulated and real figures can never mix in one partner's analytics, and refuses any id
   * or wallet address already in use, so a simulated record can never replace a real one. It
   * all runs in one transaction: the store is changed in full or not at all.
   */
  addSimulated(batch: {
    wallets: WalletRecord[];
    quotes: QuoteRecord[];
    transactions: TransactionRecord[];
  }): void {
    const all = [...batch.wallets, ...batch.quotes, ...batch.transactions];
    for (const item of all) {
      if (!item.simulated) throw new Error(`Record ${item.id} is not marked simulated`);
    }
    transaction(this.db, () => {
      for (const partner of new Set(all.map((r) => r.partnerSlug))) {
        for (const table of ["wallets", "quotes", "transactions"]) {
          const real = this.db
            .prepare(`SELECT id FROM ${table} WHERE partner_slug = ? AND simulated = 0 LIMIT 1`)
            .get(partner);
          if (real) {
            throw new Error(
              `Partner "${partner}" already has real records (${String(real.id)}); simulate into a partner of its own`,
            );
          }
        }
      }
      const clash = (kind: string, table: string, items: { id: string }[]): void => {
        const seen = new Set<string>();
        const exists = this.db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`);
        for (const { id } of items) {
          if (seen.has(id) || exists.get(id))
            throw new Error(`The ${kind} id ${id} is already in use`);
          seen.add(id);
        }
      };
      clash("wallet", "wallets", batch.wallets);
      clash("quote", "quotes", batch.quotes);
      clash("transaction", "transactions", batch.transactions);
      const seen = new Set<string>();
      const taken = this.db.prepare("SELECT 1 FROM wallets WHERE lower(address) = ?");
      for (const w of batch.wallets) {
        const address = w.address.toLowerCase();
        if (seen.has(address) || taken.get(address)) {
          throw new Error(`The wallet address ${w.address} is already in use`);
        }
        seen.add(address);
      }
      for (const w of batch.wallets) this.saveWallet(w);
      for (const q of batch.quotes) this.saveQuote(q);
      for (const t of batch.transactions) this.saveTransaction(t);
    });
  }

  /** Removes a partner's simulated records (to simulate again). Real records are never touched. */
  clearSimulated(partnerSlug: string): number {
    return transaction(this.db, () => {
      let removed = 0;
      for (const table of ["transactions", "quotes", "wallets"]) {
        removed += Number(
          this.db
            .prepare(`DELETE FROM ${table} WHERE partner_slug = ? AND simulated = 1`)
            .run(partnerSlug).changes,
        );
      }
      return removed;
    });
  }

  // ---------------------------------------------------------------- internals

  private meta(key: string): string | undefined {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(key);
    return row ? String(row.value) : undefined;
  }

  private setMeta(key: string, value: string): void {
    this.db
      .prepare(
        "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      )
      .run(key, value);
  }

  /**
   * Moves the old JSON store into this empty database, if there is one for this same chain, and
   * renames the file to `.imported` so it is kept but never read again. Returns how many records
   * came across, or undefined when there was nothing to import.
   */
  private importLegacy(chainMarker: string): number | undefined {
    if (!this.legacyJsonPath || !existsSync(this.legacyJsonPath)) return undefined;
    let legacy: LegacyState;
    try {
      legacy = JSON.parse(readFileSync(this.legacyJsonPath, "utf8")) as LegacyState;
    } catch {
      return undefined;
    }
    if (legacy.chainMarker !== chainMarker) return undefined;
    this.setMeta("chainMarker", chainMarker);
    this.setMeta("nextDerivationIndex", String(legacy.nextDerivationIndex ?? 0));
    const wallets = Object.values(legacy.wallets ?? {});
    const quotes = Object.values(legacy.quotes ?? {});
    const transactions = Object.values(legacy.transactions ?? {});
    const idempotency = Object.entries(legacy.idempotency ?? {});
    for (const w of wallets) this.saveWallet(w);
    for (const q of quotes) this.saveQuote(q);
    for (const t of transactions) this.saveTransaction(t);
    for (const [key, entry] of idempotency) this.saveIdempotency(key, entry);
    renameSync(this.legacyJsonPath, `${this.legacyJsonPath}.imported`);
    return wallets.length + quotes.length + transactions.length + idempotency.length;
  }
}
