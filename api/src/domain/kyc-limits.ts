import type { WalletRecord } from "./types.js";

export type KycLevel = WalletRecord["kycLevel"];

/**
 * What a customer at one KYC level may receive, in paisa (1 PKR = 100 paisa). "Receive" means
 * money into the gold account: purchases, and gold sent by another customer. Sales and
 * transfers out are bounded by the balance instead.
 */
export interface KycLimit {
  perTradePaisa: bigint;
  /** Across the last 24 hours, counting credits that are pending or confirmed. */
  per24HoursPaisa: bigint;
  /** Across the last 30 days: the State Bank sets account limits per calendar month. */
  per30DaysPaisa: bigint;
  /** The most the gold held may be worth after the credit, at the current price. */
  maxHoldingPaisa: bigint;
}

export type KycLimits = Record<KycLevel, KycLimit>;

const LEVELS: readonly KycLevel[] = ["asaan", "standard", "enhanced"];

/**
 * The default KYC_LIMITS, modelled on the State Bank's account levels (see docs/kyc-limits.md):
 * - asaan: like a branchless banking Level 0 wallet (Rs 25,000 a day, Rs 50,000 a month,
 *   Rs 200,000 balance).
 * - standard: like an Asaan Account (Rs 1,000,000 a month and Rs 1,000,000 balance).
 * - enhanced: full due diligence; the State Bank sets no cap, these are the partner's own.
 * Each partner must confirm the figures that apply to its own licence before going live.
 */
export const DEFAULT_KYC_LIMITS =
  "asaan=25000:25000:50000:200000," +
  "standard=200000:500000:1000000:1000000," +
  "enhanced=2500000:5000000:20000000:50000000";

/**
 * Parses KYC_LIMITS: `level=perTrade:per24Hours:per30Days:maxHolding` in PKR, comma-separated.
 * Every level must be given exactly once. Throws with a message naming what is wrong.
 */
export function parseKycLimits(text: string): KycLimits {
  const found = new Map<string, KycLimit>();
  for (const pair of text
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)) {
    const match = /^([a-z]+)=(\d+):(\d+):(\d+):(\d+)$/.exec(pair);
    if (!match) {
      throw new Error(
        `KYC_LIMITS: "${pair}" is not level=perTrade:per24Hours:per30Days:maxHolding`,
      );
    }
    const [, level, ...rupees] = match as unknown as [
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    if (!LEVELS.includes(level as KycLevel)) {
      throw new Error(`KYC_LIMITS: unknown level "${level}" (use ${LEVELS.join(", ")})`);
    }
    if (found.has(level)) throw new Error(`KYC_LIMITS: "${level}" is given twice`);
    const [perTrade, perDay, perMonth, maxHolding] = rupees.map((r) => BigInt(r) * 100n) as [
      bigint,
      bigint,
      bigint,
      bigint,
    ];
    if (perTrade === 0n || perDay < perTrade || perMonth < perDay || maxHolding < perTrade) {
      throw new Error(
        `KYC_LIMITS: for "${level}", each limit must be at least the one before it ` +
          "(per trade ≤ 24 hours ≤ 30 days; per trade ≤ holding), and none zero",
      );
    }
    found.set(level, {
      perTradePaisa: perTrade,
      per24HoursPaisa: perDay,
      per30DaysPaisa: perMonth,
      maxHoldingPaisa: maxHolding,
    });
  }
  const missing = LEVELS.filter((level) => !found.has(level));
  if (missing.length > 0) throw new Error(`KYC_LIMITS: no limit for ${missing.join(", ")}`);
  return Object.fromEntries(found) as KycLimits;
}

export type LimitBreached = "per_trade" | "per_24_hours" | "per_30_days" | "max_holding";

export interface CreditContext {
  creditedLast24HoursPaisa: bigint;
  creditedLast30DaysPaisa: bigint;
  holdingPaisa: bigint;
}

/** Which limit a credit breaks, or undefined when it is within all of them. */
export function overLimit(
  limit: KycLimit,
  creditPaisa: bigint,
  c: CreditContext,
): LimitBreached | undefined {
  if (creditPaisa > limit.perTradePaisa) return "per_trade";
  if (c.creditedLast24HoursPaisa + creditPaisa > limit.per24HoursPaisa) return "per_24_hours";
  if (c.creditedLast30DaysPaisa + creditPaisa > limit.per30DaysPaisa) return "per_30_days";
  if (c.holdingPaisa + creditPaisa > limit.maxHoldingPaisa) return "max_holding";
  return undefined;
}

/** The largest credit that would pass every limit now. */
export function headroom(limit: KycLimit, c: CreditContext): bigint {
  const left = (cap: bigint, used: bigint) => (cap > used ? cap - used : 0n);
  return [
    limit.perTradePaisa,
    left(limit.per24HoursPaisa, c.creditedLast24HoursPaisa),
    left(limit.per30DaysPaisa, c.creditedLast30DaysPaisa),
    left(limit.maxHoldingPaisa, c.holdingPaisa),
  ].reduce((a, b) => (a < b ? a : b));
}
