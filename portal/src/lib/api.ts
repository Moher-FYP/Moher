"use client";

/**
 * Calls the portal routes of the MOHAR API (docs/portal-openapi.yaml). Same origin: next.config
 * passes /portal/v1/* through to the API, so the browser sends the session cookie and the
 * Origin header by itself. Nothing here ever holds a key or a session token.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

/** Called when a request answers 401: the session ended, so go to the sign-in page. */
let onSignedOut: (() => void) | undefined;
export function whenSignedOut(handler: () => void): void {
  onSignedOut = handler;
}

export async function api<T>(
  path: string,
  options: { method?: "GET" | "POST" | "PUT" | "DELETE"; body?: unknown } = {},
): Promise<T> {
  const response = await fetch(`/portal/v1${path}`, {
    method: options.method ?? "GET",
    credentials: "same-origin",
    cache: "no-store",
    headers: options.body !== undefined ? { "Content-Type": "application/json" } : {},
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  if (response.status === 204) return undefined as T;
  const data = (await response.json().catch(() => ({}))) as {
    error?: { code: string; message: string; details?: Record<string, unknown> };
  };
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith("/session")) onSignedOut?.();
    throw new ApiError(
      response.status,
      data.error?.code ?? "unknown",
      data.error?.message ?? `Request failed (${response.status})`,
      data.error?.details,
    );
  }
  return data as T;
}

// ---------------------------------------------------------------- shapes (portal-openapi.yaml)

export type Role = "viewer" | "developer" | "compliance" | "operator";

export interface Me {
  user: { id: string; email: string; role: Role; partner?: string };
  sessionExpiresAt: string;
  idleTimeoutSeconds: number;
}

export interface Transaction {
  id: string;
  type: "mint" | "burn" | "transfer";
  status: "pending" | "submitted" | "confirmed" | "failed";
  walletId: string;
  counterpartyWalletId?: string;
  grams: string;
  quoteId?: string;
  netAmountPkr?: string;
  txHash?: string;
  explorerUrl?: string;
  blockNumber?: number;
  failureCode?: string;
  createdAt: string;
  confirmedAt?: string;
}

export interface Page<T> {
  data: T[];
  nextCursor?: string;
}

export interface Overview {
  partner: string;
  customers: number;
  goldHeldGrams: string;
  goldHeldPkr: string;
  volume30DaysPkr: string;
  failedLast7Days: number;
  reserve?: { fullyBacked: boolean; asOf: string };
  latestTransactions: Transaction[];
}

export type KycLevel = "asaan" | "standard" | "enhanced";

export interface Wallet {
  id: string;
  externalCustomerId: string;
  address: string;
  kycLevel: KycLevel;
  createdAt: string;
}

export interface LimitUse {
  limitPkr: string;
  usedPkr: string;
}

export interface WalletDetail extends Wallet {
  status: "active" | "frozen";
  balanceGrams: string;
  valuePkr: string;
  explorerUrl?: string;
  limits: { perTradePkr: string; last24Hours: LimitUse; last30Days: LimitUse; holding: LimitUse };
}

export interface Quote {
  id: string;
  side: "buy" | "sell";
  grams: string;
  grossAmountPkr: string;
  netAmountPkr: string;
  fees: { platformFeePkr: string; fxMarginPkr: string };
  price: { xauUsd: string; usdPkr: string; pricePerGramPkr: string; asOf: string; source: string };
  expiresAt: string;
  createdAt: string;
}

export interface TransactionDetail {
  transaction: Transaction;
  quote?: Quote;
  failureMessage?: string;
}

export interface Limits {
  levels: {
    level: KycLevel;
    perTradePkr: string;
    per24HoursPkr: string;
    per30DaysPkr: string;
    maxHoldingPkr: string;
    customers: number;
  }[];
}

export interface AuditEntry {
  seq: number;
  at: string;
  userId?: string;
  email?: string;
  partner?: string;
  action: string;
  target?: string;
  result: "ok" | "refused" | "failed";
  detail?: Record<string, unknown>;
  ip?: string;
  hash: string;
  prevHash: string;
}

export interface ChainCheck {
  intact: boolean;
  entries: number;
  firstBrokenSeq?: number;
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
  status: "active" | "revoked";
}

export interface WebhookSettings {
  url?: string;
  secretSet: boolean;
  secretSetAt?: string;
  localhostAllowed: boolean;
}

export interface Delivery {
  id: string;
  eventId: string;
  transactionId: string;
  event: string;
  url: string;
  status: "pending" | "delivered" | "failed";
  attempts: { at: string; statusCode?: number; error?: string; ms: number }[];
  createdAt: string;
  nextAttemptAt?: string;
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

export interface PartnerRow {
  slug: string;
  partnerId: string;
  activeOnChain: boolean;
  customers: number;
  webhookUrl?: string;
}

export interface ManagedUser {
  id: string;
  email: string;
  role: Role;
  partner?: string;
  status: "active" | "disabled";
  failedAttempts: number;
  lastFailedAt?: string;
  createdAt: string;
}

export interface IssuedSecrets {
  user: ManagedUser;
  password: string;
  setupKey: string;
  otpauthUri: string;
}

export interface AnchorCheck {
  anchors: number;
  intact: boolean;
  lastAnchoredAt?: string;
  lastTxHash?: string;
  lastExplorerUrl?: string;
  problem?: string;
}
