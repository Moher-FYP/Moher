import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Portal records: users, sessions, and the two logs. Kept apart from the trading store because
 * the trading store starts fresh when the chain does, and portal users and their history must
 * not vanish with a new Anvil chain. Same write-through JSON approach as store/store.ts.
 */

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

interface State {
  version: 1;
  users: Record<string, PortalUserRecord>;
  sessions: Record<string, SessionRecord>;
  logs: Record<LogName, LogEntry[]>;
  apiKeys: Record<string, ApiKeyRecord>;
  partnerSettings: Record<string, PartnerSettings>;
  deliveries: WebhookDelivery[];
  freezeRequests: Record<string, FreezeRequest>;
}

/** Each log keeps its newest entries; a real deployment ships them to separate storage. */
export const LOG_CAP = 10_000;
const GENESIS = "0".repeat(64);

const emptyState = (): State => ({
  version: 1,
  users: {},
  sessions: {},
  logs: { audit: [], security: [] },
  apiKeys: {},
  partnerSettings: {},
  deliveries: [],
  freezeRequests: {},
});

export class PortalStore {
  private state: State = emptyState();

  constructor(
    private readonly filePath: string | null,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (filePath) {
      try {
        // Files from part 1 lack the later collections; start those empty.
        this.state = { ...emptyState(), ...(JSON.parse(readFileSync(filePath, "utf8")) as State) };
      } catch {
        this.persist();
      }
    }
  }

  // ---------------------------------------------------------------- users

  saveUser(user: PortalUserRecord): void {
    this.state.users[user.id] = user;
    this.persist();
  }

  getUser(id: string): PortalUserRecord | undefined {
    return this.state.users[id];
  }

  findUserByEmail(email: string): PortalUserRecord | undefined {
    const wanted = email.trim().toLowerCase();
    return Object.values(this.state.users).find((u) => u.email === wanted);
  }

  allUsers(): PortalUserRecord[] {
    return Object.values(this.state.users);
  }

  updateUser(id: string, patch: Partial<PortalUserRecord>): PortalUserRecord {
    const existing = this.state.users[id];
    if (!existing) throw new Error(`Unknown portal user ${id}`);
    const updated = { ...existing, ...patch };
    this.state.users[id] = updated;
    this.persist();
    return updated;
  }

  // ---------------------------------------------------------------- sessions

  saveSession(session: SessionRecord): void {
    this.state.sessions[session.tokenHash] = session;
    this.persist();
  }

  getSession(tokenHash: string): SessionRecord | undefined {
    return this.state.sessions[tokenHash];
  }

  /** Records activity. Not persisted on every request; the next real write saves it. */
  touchSession(tokenHash: string, at: string): void {
    const session = this.state.sessions[tokenHash];
    if (session) session.lastSeenAt = at;
  }

  deleteSession(tokenHash: string): void {
    delete this.state.sessions[tokenHash];
    this.persist();
  }

  /** Ends every session of a user (after a disable, or a password change). */
  deleteSessionsOf(userId: string): void {
    for (const [hash, session] of Object.entries(this.state.sessions)) {
      if (session.userId === userId) delete this.state.sessions[hash];
    }
    this.persist();
  }

  /** Drops sessions that have ended, so the file does not grow without limit. */
  pruneSessions(isLive: (s: SessionRecord) => boolean): void {
    let changed = false;
    for (const [hash, session] of Object.entries(this.state.sessions)) {
      if (!isLive(session)) {
        delete this.state.sessions[hash];
        changed = true;
      }
    }
    if (changed) this.persist();
  }

  // ---------------------------------------------------------------- API keys

  saveApiKey(key: ApiKeyRecord): void {
    this.state.apiKeys[key.id] = key;
    this.persist();
  }

  getApiKey(id: string): ApiKeyRecord | undefined {
    return this.state.apiKeys[id];
  }

  apiKeysOf(partnerSlug: string): ApiKeyRecord[] {
    return Object.values(this.state.apiKeys)
      .filter((k) => k.partnerSlug === partnerSlug)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** The live (not revoked) key with this hash. */
  findLiveKeyByHash(hash: string): ApiKeyRecord | undefined {
    return Object.values(this.state.apiKeys).find((k) => k.hash === hash && !k.revokedAt);
  }

  updateApiKey(id: string, patch: Partial<ApiKeyRecord>, persist = true): void {
    const existing = this.state.apiKeys[id];
    if (!existing) throw new Error(`Unknown API key ${id}`);
    this.state.apiKeys[id] = { ...existing, ...patch };
    if (persist) this.persist();
  }

  // ---------------------------------------------------------------- partner settings

  partnerSettings(slug: string): PartnerSettings {
    return this.state.partnerSettings[slug] ?? {};
  }

  allPartnerSettings(): Record<string, PartnerSettings> {
    return this.state.partnerSettings;
  }

  updatePartnerSettings(slug: string, patch: PartnerSettings): void {
    this.state.partnerSettings[slug] = { ...this.partnerSettings(slug), ...patch };
    this.persist();
  }

  // ---------------------------------------------------------------- webhook deliveries

  saveDelivery(delivery: WebhookDelivery): void {
    const at = this.state.deliveries.findIndex((d) => d.id === delivery.id);
    if (at >= 0) this.state.deliveries[at] = delivery;
    else this.state.deliveries.push(delivery);
    if (this.state.deliveries.length > LOG_CAP) {
      this.state.deliveries.splice(0, this.state.deliveries.length - LOG_CAP);
    }
    this.persist();
  }

  getDelivery(id: string): WebhookDelivery | undefined {
    return this.state.deliveries.find((d) => d.id === id);
  }

  /** Newest first. */
  deliveriesOf(partnerSlug: string, transactionId?: string): WebhookDelivery[] {
    return this.state.deliveries
      .filter(
        (d) =>
          d.partnerSlug === partnerSlug && (!transactionId || d.transactionId === transactionId),
      )
      .reverse();
  }

  // ---------------------------------------------------------------- freeze requests

  saveFreezeRequest(request: FreezeRequest): void {
    this.state.freezeRequests[request.id] = request;
    this.persist();
  }

  getFreezeRequest(id: string): FreezeRequest | undefined {
    return this.state.freezeRequests[id];
  }

  /** Newest first; one partner's, or every partner's when no slug is given. */
  freezeRequests(partnerSlug?: string): FreezeRequest[] {
    return Object.values(this.state.freezeRequests)
      .filter((r) => !partnerSlug || r.partnerSlug === partnerSlug)
      .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  }

  // ---------------------------------------------------------------- logs

  /**
   * Appends to a log. Each entry stores the hash of the one before it and its own hash over
   * its contents, so changing or removing any entry breaks every hash after it.
   */
  log(name: LogName, input: LogInput): LogEntry {
    const entries = this.state.logs[name];
    const last = entries.at(-1);
    const base = {
      seq: (last?.seq ?? 0) + 1,
      at: this.now().toISOString(),
      ...definedOnly(input),
      prevHash: last?.hash ?? GENESIS,
    };
    const entry: LogEntry = { ...base, hash: entryHash(base) };
    entries.push(entry);
    if (entries.length > LOG_CAP) entries.splice(0, entries.length - LOG_CAP);
    this.persist();
    return entry;
  }

  /** Newest first, optionally only one partner's. The cursor is the seq of the last item. */
  listLog(
    name: LogName,
    options: { partner?: string | undefined; limit: number; cursor?: number | undefined },
  ): { data: LogEntry[]; nextCursor?: number } {
    const matching = this.state.logs[name]
      .filter((e) => !options.partner || e.partner === options.partner)
      .filter((e) => options.cursor === undefined || e.seq < options.cursor)
      .reverse();
    const data = matching.slice(0, options.limit);
    return {
      data,
      ...(matching.length > options.limit ? { nextCursor: data.at(-1)!.seq } : {}),
    };
  }

  /** Recomputes the chain. The oldest kept entry is trusted as the start (older ones are capped). */
  verifyLog(name: LogName): { intact: boolean; entries: number; firstBrokenSeq?: number } {
    const entries = this.state.logs[name];
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

  /** Tests only: lets a test tamper with an entry to prove the check catches it. */
  rawLog(name: LogName): LogEntry[] {
    return this.state.logs[name];
  }

  // ---------------------------------------------------------------- persistence

  private persist(): void {
    if (!this.filePath) return;
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.state, null, 2), { mode: 0o600 });
    renameSync(tmp, this.filePath);
    chmodSync(this.filePath, 0o600);
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
