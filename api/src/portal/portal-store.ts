import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync } from "node:fs";
import { col, openDatabase, record, records, transaction, type Database } from "../store/sqlite.js";

export type PortalRole = "viewer" | "developer" | "compliance" | "operator";

export interface PortalUserRecord {
  id: string;
  /** Lower-cased. */
  email: string;
  /** Absent for operators (MOHAR staff). */
  partnerSlug?: string;
  role: PortalRole;
  passwordHash: string;
  /** The authenticator secret, sealed with PORTAL_SECRET_KEY (portal/sealed.ts). */
  totpSecretSealed: string;
  /** The last one-time code step used, so a code cannot be used twice. */
  totpLastCounter?: number;
  status: "active" | "disabled";
  failedAttempts: number;
  lastFailedAt?: string;
  createdAt: string;
}

export interface SessionRecord {
  /** SHA-256 of the cookie value. The value itself is never stored. */
  tokenHash: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
  ip?: string;
}

export interface ApiKeyRecord {
  id: string;
  partnerSlug: string;
  name: string;
  /** The first characters, for recognising the key in a list. */
  prefix: string;
  /** SHA-256 of the key. The key itself is shown once and never stored. */
  hash: string;
  createdAt: string;
  createdBy: string;
  lastUsedAt?: string;
  revokedAt?: string;
  revokedBy?: string;
}

/** Settings a partner changed in the portal; they override the start-up configuration. */
export interface PartnerSettings {
  webhookUrl?: string;
  /** Sealed with PORTAL_SECRET_KEY. */
  webhookSecretSealed?: string;
  webhookSecretSetAt?: string;
}

export interface DeliveryAttempt {
  at: string;
  statusCode?: number;
  error?: string;
  ms: number;
}

export interface WebhookDelivery {
  /** This delivery, dlv_… */
  id: string;
  /** The event it carries, evt_…; a resend carries the same event, so the partner can dedupe. */
  eventId: string;
  partnerSlug: string;
  transactionId: string;
  event: string;
  url: string;
  /** The signed JSON body, kept so the partner can ask for it again. */
  body: string;
  status: "pending" | "delivered" | "failed";
  attempts: DeliveryAttempt[];
  createdAt: string;
  /** While pending after a failed attempt: when the next one is due. */
  nextAttemptAt?: string | undefined;
  /** Set when this delivery is a resend of another. */
  resendOf?: string;
}

export interface FreezeRequest {
  id: string;
  partnerSlug: string;
  walletId: string;
  action: "freeze" | "unfreeze";
  reason: string;
  requestedBy: string;
  requestedAt: string;
  status: "pending" | "done" | "rejected" | "failed";
  decidedBy?: string;
  decidedAt?: string;
  txHash?: string;
  failure?: string;
}

/** The latest entry of each log, written on-chain in one transaction (portal/anchor.ts). */
export interface AnchorRecord {
  at: string;
  audit: { seq: number; hash: string };
  security: { seq: number; hash: string };
  txHash: string;
}

export type LogName = "audit" | "security";

export interface LogInput {
  userId?: string | undefined;
  email?: string | undefined;
  partner?: string | undefined;
  action: string;
  target?: string | undefined;
  result: "ok" | "refused" | "failed";
  detail?: Record<string, unknown> | undefined;
  ip?: string | undefined;
}

export interface LogEntry extends LogInput {
  seq: number;
  at: string;
  prevHash: string;
  hash: string;
}

/** The JSON file this store replaced (`portal.json`), imported once if it is found. */
interface LegacyState {
  users?: Record<string, PortalUserRecord>;
  sessions?: Record<string, SessionRecord>;
  logs?: Partial<Record<LogName, LogEntry[]>>;
  apiKeys?: Record<string, ApiKeyRecord>;
  partnerSettings?: Record<string, PartnerSettings>;
  deliveries?: WebhookDelivery[];
  freezeRequests?: Record<string, FreezeRequest>;
  anchors?: AnchorRecord[];
}

/** Each log keeps its newest entries; a real deployment ships them to separate storage. */
export const LOG_CAP = 10_000;
const GENESIS = "0".repeat(64);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id    TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  data  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  data       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);
CREATE TABLE IF NOT EXISTS api_keys (
  id           TEXT PRIMARY KEY,
  partner_slug TEXT NOT NULL,
  hash         TEXT NOT NULL,
  revoked      INTEGER NOT NULL,
  created_at   TEXT NOT NULL,
  data         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS api_keys_hash ON api_keys (hash);
CREATE TABLE IF NOT EXISTS partner_settings (
  slug TEXT PRIMARY KEY,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS deliveries (
  ord             INTEGER PRIMARY KEY AUTOINCREMENT,
  id              TEXT NOT NULL UNIQUE,
  partner_slug    TEXT NOT NULL,
  transaction_id  TEXT NOT NULL,
  status          TEXT NOT NULL,
  next_attempt_at TEXT,
  data            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS deliveries_partner ON deliveries (partner_slug, transaction_id);
CREATE INDEX IF NOT EXISTS deliveries_due ON deliveries (status, next_attempt_at);
CREATE TABLE IF NOT EXISTS freeze_requests (
  id           TEXT PRIMARY KEY,
  partner_slug TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  data         TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS anchors (
  ord  INTEGER PRIMARY KEY AUTOINCREMENT,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS log_entries (
  log     TEXT NOT NULL,
  seq     INTEGER NOT NULL,
  partner TEXT,
  data    TEXT NOT NULL,
  PRIMARY KEY (log, seq)
);
CREATE INDEX IF NOT EXISTS log_entries_partner ON log_entries (log, partner, seq);
`;

/**
 * Portal records: users, sessions, API keys, webhook deliveries, freeze requests and the two
 * hash-chained logs, in SQLite (store/sqlite.ts says why). Kept apart from the trading store
 * (`portal.db`, not `store-<chainId>.db`) because the trading store starts fresh when the
 * chain does, and portal users and their history must not vanish with a new Anvil chain.
 * Pass `null` as the path for an in-memory database (tests).
 */
export class PortalStore {
  private readonly db: Database;

  constructor(
    path: string | null,
    private readonly now: () => Date = () => new Date(),
    legacyJsonPath?: string,
  ) {
    this.db = openDatabase(path, { private: true });
    this.db.exec(SCHEMA);
    if (legacyJsonPath) this.importLegacy(legacyJsonPath);
  }

  /** Closes the database file (CLIs, before they exit). */
  close(): void {
    this.db.close();
  }

  // ---------------------------------------------------------------- users

  saveUser(user: PortalUserRecord): void {
    this.db
      .prepare(
        `INSERT INTO users (id, email, data) VALUES (?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET email = excluded.email, data = excluded.data`,
      )
      .run(user.id, user.email, JSON.stringify(user));
  }

  getUser(id: string): PortalUserRecord | undefined {
    return record(this.db.prepare("SELECT data FROM users WHERE id = ?").get(id));
  }

  findUserByEmail(email: string): PortalUserRecord | undefined {
    return record(
      this.db.prepare("SELECT data FROM users WHERE email = ?").get(email.trim().toLowerCase()),
    );
  }

  allUsers(): PortalUserRecord[] {
    return records(this.db.prepare("SELECT data FROM users ORDER BY rowid").all());
  }

  updateUser(id: string, patch: Partial<PortalUserRecord>): PortalUserRecord {
    return transaction(this.db, () => {
      const existing = this.getUser(id);
      if (!existing) throw new Error(`Unknown portal user ${id}`);
      const updated = { ...existing, ...patch };
      this.saveUser(updated);
      return updated;
    });
  }

  // ---------------------------------------------------------------- sessions

  saveSession(session: SessionRecord): void {
    this.db
      .prepare(
        `INSERT INTO sessions (token_hash, user_id, data) VALUES (?, ?, ?)
         ON CONFLICT (token_hash) DO UPDATE SET user_id = excluded.user_id, data = excluded.data`,
      )
      .run(session.tokenHash, session.userId, JSON.stringify(session));
  }

  getSession(tokenHash: string): SessionRecord | undefined {
    return record(this.db.prepare("SELECT data FROM sessions WHERE token_hash = ?").get(tokenHash));
  }

  /** Records activity on a session (for the idle timeout). */
  touchSession(tokenHash: string, at: string): void {
    this.db
      .prepare("UPDATE sessions SET data = json_set(data, '$.lastSeenAt', ?) WHERE token_hash = ?")
      .run(at, tokenHash);
  }

  deleteSession(tokenHash: string): void {
    this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
  }

  /** Ends every session of a user (after a disable, or a password change). */
  deleteSessionsOf(userId: string): void {
    this.db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
  }

  /** Drops sessions that have ended, so the table does not grow without limit. */
  pruneSessions(isLive: (s: SessionRecord) => boolean): void {
    transaction(this.db, () => {
      const all = records<SessionRecord>(this.db.prepare("SELECT data FROM sessions").all());
      const drop = this.db.prepare("DELETE FROM sessions WHERE token_hash = ?");
      for (const session of all) if (!isLive(session)) drop.run(session.tokenHash);
    });
  }

  // ---------------------------------------------------------------- API keys

  saveApiKey(key: ApiKeyRecord): void {
    this.db
      .prepare(
        `INSERT INTO api_keys (id, partner_slug, hash, revoked, created_at, data) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET partner_slug = excluded.partner_slug, hash = excluded.hash,
           revoked = excluded.revoked, created_at = excluded.created_at, data = excluded.data`,
      )
      .run(
        key.id,
        key.partnerSlug,
        key.hash,
        col(Boolean(key.revokedAt)),
        key.createdAt,
        JSON.stringify(key),
      );
  }

  getApiKey(id: string): ApiKeyRecord | undefined {
    return record(this.db.prepare("SELECT data FROM api_keys WHERE id = ?").get(id));
  }

  apiKeysOf(partnerSlug: string): ApiKeyRecord[] {
    return records(
      this.db
        .prepare("SELECT data FROM api_keys WHERE partner_slug = ? ORDER BY created_at DESC")
        .all(partnerSlug),
    );
  }

  /** The live (not revoked) key with this hash. */
  findLiveKeyByHash(hash: string): ApiKeyRecord | undefined {
    return record(
      this.db.prepare("SELECT data FROM api_keys WHERE hash = ? AND revoked = 0").get(hash),
    );
  }

  updateApiKey(id: string, patch: Partial<ApiKeyRecord>): void {
    transaction(this.db, () => {
      const existing = this.getApiKey(id);
      if (!existing) throw new Error(`Unknown API key ${id}`);
      this.saveApiKey({ ...existing, ...patch });
    });
  }

  // ---------------------------------------------------------------- partner settings

  partnerSettings(slug: string): PartnerSettings {
    return (
      record<PartnerSettings>(
        this.db.prepare("SELECT data FROM partner_settings WHERE slug = ?").get(slug),
      ) ?? {}
    );
  }

  allPartnerSettings(): Record<string, PartnerSettings> {
    const rows = this.db.prepare("SELECT slug, data FROM partner_settings").all();
    return Object.fromEntries(
      rows.map((row) => [String(row.slug), JSON.parse(String(row.data)) as PartnerSettings]),
    );
  }

  updatePartnerSettings(slug: string, patch: PartnerSettings): void {
    transaction(this.db, () => {
      const updated = { ...this.partnerSettings(slug), ...patch };
      this.db
        .prepare(
          `INSERT INTO partner_settings (slug, data) VALUES (?, ?)
           ON CONFLICT (slug) DO UPDATE SET data = excluded.data`,
        )
        .run(slug, JSON.stringify(updated));
    });
  }

  // ---------------------------------------------------------------- webhook deliveries

  saveDelivery(delivery: WebhookDelivery): void {
    transaction(this.db, () => {
      this.db
        .prepare(
          `INSERT INTO deliveries (id, partner_slug, transaction_id, status, next_attempt_at, data)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (id) DO UPDATE SET status = excluded.status,
             next_attempt_at = excluded.next_attempt_at, data = excluded.data`,
        )
        .run(
          delivery.id,
          delivery.partnerSlug,
          delivery.transactionId,
          delivery.status,
          col(delivery.nextAttemptAt),
          JSON.stringify(delivery),
        );
      // Over the cap: drop the oldest finished ones; a delivery still waiting to retry is kept.
      const count = Number(this.db.prepare("SELECT count(*) AS n FROM deliveries").get()!.n);
      if (count > LOG_CAP) {
        this.db
          .prepare(
            `DELETE FROM deliveries WHERE ord IN (
               SELECT ord FROM deliveries WHERE status != 'pending' ORDER BY ord LIMIT ?)`,
          )
          .run(count - LOG_CAP);
      }
    });
  }

  /** Pending deliveries whose next attempt is due (webhooks.ts sends them). */
  dueDeliveries(nowIso: string): WebhookDelivery[] {
    return records(
      this.db
        .prepare(
          "SELECT data FROM deliveries WHERE status = 'pending' AND next_attempt_at <= ? ORDER BY ord",
        )
        .all(nowIso),
    );
  }

  getDelivery(id: string): WebhookDelivery | undefined {
    return record(this.db.prepare("SELECT data FROM deliveries WHERE id = ?").get(id));
  }

  /** Newest first. */
  deliveriesOf(partnerSlug: string, transactionId?: string): WebhookDelivery[] {
    return transactionId
      ? records(
          this.db
            .prepare(
              "SELECT data FROM deliveries WHERE partner_slug = ? AND transaction_id = ? ORDER BY ord DESC",
            )
            .all(partnerSlug, transactionId),
        )
      : records(
          this.db
            .prepare("SELECT data FROM deliveries WHERE partner_slug = ? ORDER BY ord DESC")
            .all(partnerSlug),
        );
  }

  // ---------------------------------------------------------------- freeze requests

  saveFreezeRequest(request: FreezeRequest): void {
    this.db
      .prepare(
        `INSERT INTO freeze_requests (id, partner_slug, requested_at, data) VALUES (?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET data = excluded.data`,
      )
      .run(request.id, request.partnerSlug, request.requestedAt, JSON.stringify(request));
  }

  getFreezeRequest(id: string): FreezeRequest | undefined {
    return record(this.db.prepare("SELECT data FROM freeze_requests WHERE id = ?").get(id));
  }

  /** Newest first; one partner's, or every partner's when no slug is given. */
  freezeRequests(partnerSlug?: string): FreezeRequest[] {
    return partnerSlug
      ? records(
          this.db
            .prepare(
              "SELECT data FROM freeze_requests WHERE partner_slug = ? ORDER BY requested_at DESC",
            )
            .all(partnerSlug),
        )
      : records(
          this.db.prepare("SELECT data FROM freeze_requests ORDER BY requested_at DESC").all(),
        );
  }

  // ---------------------------------------------------------------- anchors

  saveAnchor(anchor: AnchorRecord): void {
    this.db.prepare("INSERT INTO anchors (data) VALUES (?)").run(JSON.stringify(anchor));
  }

  anchors(): AnchorRecord[] {
    return records(this.db.prepare("SELECT data FROM anchors ORDER BY ord").all());
  }

  /** The newest entry's seq and hash (seq 0 and the zero hash for an empty log). */
  head(name: LogName): { seq: number; hash: string } {
    const last = record<LogEntry>(
      this.db
        .prepare("SELECT data FROM log_entries WHERE log = ? ORDER BY seq DESC LIMIT 1")
        .get(name),
    );
    return last ? { seq: last.seq, hash: last.hash } : { seq: 0, hash: GENESIS };
  }

  /** The entry with this seq, if the log still holds it (old entries are capped away). */
  entry(name: LogName, seq: number): LogEntry | undefined {
    return record(
      this.db.prepare("SELECT data FROM log_entries WHERE log = ? AND seq = ?").get(name, seq),
    );
  }

  // ---------------------------------------------------------------- logs

  /**
   * Appends to a log. Each entry stores the hash of the one before it and its own hash over
   * its contents, so changing or removing any entry breaks every hash after it. Reading the
   * head and writing the entry are one transaction, so two processes cannot both write seq n.
   */
  log(name: LogName, input: LogInput): LogEntry {
    return transaction(this.db, () => {
      const last = this.head(name);
      const base = {
        seq: last.seq + 1,
        at: this.now().toISOString(),
        ...definedOnly(input),
        prevHash: last.hash,
      };
      const entry: LogEntry = { ...base, hash: entryHash(base) };
      this.insertLogEntry(name, entry);
      this.db
        .prepare("DELETE FROM log_entries WHERE log = ? AND seq <= ?")
        .run(name, entry.seq - LOG_CAP);
      return entry;
    });
  }

  /** Newest first, optionally only one partner's. The cursor is the seq of the last item. */
  listLog(
    name: LogName,
    options: { partner?: string | undefined; limit: number; cursor?: number | undefined },
  ): { data: LogEntry[]; nextCursor?: number } {
    const where = ["log = ?"];
    const params: (string | number)[] = [name];
    if (options.partner) {
      where.push("partner = ?");
      params.push(options.partner);
    }
    if (options.cursor !== undefined) {
      where.push("seq < ?");
      params.push(options.cursor);
    }
    const rows = records<LogEntry>(
      this.db
        .prepare(
          `SELECT data FROM log_entries WHERE ${where.join(" AND ")} ORDER BY seq DESC LIMIT ?`,
        )
        .all(...params, options.limit + 1),
    );
    const data = rows.slice(0, options.limit);
    return { data, ...(rows.length > options.limit ? { nextCursor: data.at(-1)!.seq } : {}) };
  }

  /** Recomputes the chain. The oldest kept entry is trusted as the start (older ones are capped). */
  verifyLog(name: LogName): { intact: boolean; entries: number; firstBrokenSeq?: number } {
    const entries = this.rawLog(name);
    let prev = entries[0]?.prevHash ?? GENESIS;
    for (const entry of entries) {
      const { hash, ...rest } = entry;
      if (entry.prevHash !== prev || entryHash(rest) !== hash) {
        return { intact: false, entries: entries.length, firstBrokenSeq: entry.seq };
      }
      prev = hash;
    }
    return { intact: true, entries: entries.length };
  }

  /** Every entry still kept, oldest first (verification and tests). */
  rawLog(name: LogName): LogEntry[] {
    return records(
      this.db.prepare("SELECT data FROM log_entries WHERE log = ? ORDER BY seq").all(name),
    );
  }

  /**
   * Tests only: direct SQL on the database, to play someone who edits the file behind the
   * API's back (a changed log entry, a deleted one, a forged anchor) and prove the checks
   * catch it.
   */
  unsafeSqlForTests(sql: string, ...params: (string | number | null)[]): void {
    this.db.prepare(sql).run(...params);
  }

  // ---------------------------------------------------------------- internals

  private insertLogEntry(name: LogName, entry: LogEntry): void {
    this.db
      .prepare("INSERT INTO log_entries (log, seq, partner, data) VALUES (?, ?, ?, ?)")
      .run(name, entry.seq, col(entry.partner), JSON.stringify(entry));
  }

  /**
   * Moves the old portal.json into this database if the database is still empty, and renames
   * the file to `.imported` so it is kept but never read again. Users, their sealed
   * authenticator secrets, keys, deliveries and both logs (hashes unchanged) come across.
   */
  private importLegacy(path: string): void {
    if (!existsSync(path)) return;
    const empty =
      !this.db.prepare("SELECT 1 FROM users LIMIT 1").get() &&
      !this.db.prepare("SELECT 1 FROM log_entries LIMIT 1").get();
    if (!empty) return;
    let legacy: LegacyState;
    try {
      legacy = JSON.parse(readFileSync(path, "utf8")) as LegacyState;
    } catch {
      return;
    }
    transaction(this.db, () => {
      for (const user of Object.values(legacy.users ?? {})) this.saveUser(user);
      for (const session of Object.values(legacy.sessions ?? {})) this.saveSession(session);
      for (const key of Object.values(legacy.apiKeys ?? {})) this.saveApiKey(key);
      for (const [slug, settings] of Object.entries(legacy.partnerSettings ?? {})) {
        this.updatePartnerSettings(slug, settings);
      }
      for (const delivery of legacy.deliveries ?? []) this.saveDelivery(delivery);
      for (const request of Object.values(legacy.freezeRequests ?? {}))
        this.saveFreezeRequest(request);
      for (const anchor of legacy.anchors ?? []) this.saveAnchor(anchor);
      for (const name of ["audit", "security"] as const) {
        for (const entry of legacy.logs?.[name] ?? []) this.insertLogEntry(name, entry);
      }
    });
    renameSync(path, `${path}.imported`);
  }
}

/** The hash covers every field in a fixed order, so the same entry always hashes the same. */
function entryHash(entry: Omit<LogEntry, "hash">): string {
  const ordered = [
    entry.seq,
    entry.at,
    entry.userId ?? null,
    entry.email ?? null,
    entry.partner ?? null,
    entry.action,
    entry.target ?? null,
    entry.result,
    entry.detail ?? null,
    entry.ip ?? null,
    entry.prevHash,
  ];
  return createHash("sha256").update(JSON.stringify(ordered)).digest("hex");
}

function definedOnly(input: LogInput): LogInput {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as unknown as LogInput;
}
