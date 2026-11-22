import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

/**
 * The API's database: SQLite, through Node's built-in `node:sqlite` (Node 22.13 or later; no
 * package to install, no server to run). One file per store in DATA_DIR.
 *
 * Why SQLite and not the JSON files it replaces: every read goes to the file and every write is
 * a transaction, so several processes can use the same data at once. The API can stay running
 * while the history simulator or `portal:user` writes, and each sees the other's changes at
 * once. With the JSON files, whichever process saved last silently threw away the other's work.
 *
 * Records are kept as JSON in a `data` column, with the fields the queries need copied into
 * their own indexed columns. That keeps the record types (domain/types.ts) the single
 * definition of a record, while lookups such as "this partner's transactions, newest first"
 * run as SQL on an index.
 */

export type Database = DatabaseSync;

/** Opens (creating if needed) a database file, or an in-memory one for `null` (tests). */
export function openDatabase(path: string | null, options: { private?: boolean } = {}): Database {
  if (path) mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path ?? ":memory:");
  // WAL lets readers carry on while one process writes; busy_timeout makes a second writer
  // wait for the first (up to 5 s) instead of failing at once.
  db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
  if (path && options.private) {
    // Portal data (password hashes, sealed secrets): readable by this user only, like portal.json was.
    for (const file of [path, `${path}-wal`, `${path}-shm`]) {
      if (existsSync(file)) chmodSync(file, 0o600);
    }
  }
  return db;
}

/**
 * Runs `work` as one transaction: all of it is written or none of it. BEGIN IMMEDIATE takes
 * the write lock at the start, so a read-then-write (the next derivation index, the next log
 * entry) cannot interleave with another process doing the same. Nested calls join the outer
 * transaction.
 */
export function transaction<T>(db: Database, work: () => T): T {
  if (db.isTransaction) return work();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** The record in a row's `data` column. */
export function record<T>(row: Record<string, unknown> | undefined): T | undefined {
  return row ? (JSON.parse(row.data as string) as T) : undefined;
}

export function records<T>(rows: Record<string, unknown>[]): T[] {
  return rows.map((row) => JSON.parse(row.data as string) as T);
}

/** A value for an indexed column: SQLite has no undefined or boolean. */
export function col(value: string | number | boolean | undefined | null): SQLInputValue {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  return value;
}
