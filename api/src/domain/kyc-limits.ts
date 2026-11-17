import type { WalletRecord } from "./types.js";

export type KycLevel = WalletRecord["kycLevel"];

/** How much a customer at one KYC level may buy, in paisa (1 PKR = 100 paisa). */
export interface KycLimit {
  perTradePaisa: bigint;
  /** Across the last 24 hours, counting purchases that are pending or confirmed. */
  per24HoursPaisa: bigint;
}

export type KycLimits = Record<KycLevel, KycLimit>;

const LEVELS: readonly KycLevel[] = ["asaan", "standard", "enhanced"];

/**
 * Parses KYC_LIMITS: `level=perTradePkr:per24HoursPkr` pairs, comma-separated, e.g.
 * `asaan=50000:100000,standard=500000:1000000,enhanced=2500000:5000000`. Every level must be
 * given exactly once. Throws with a message naming what is wrong.
 */
export function parseKycLimits(text: string): KycLimits {
  const found = new Map<string, KycLimit>();
  for (const pair of text
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)) {
    const match = /^([a-z]+)=(\d+):(\d+)$/.exec(pair);
    if (!match) throw new Error(`KYC_LIMITS: "${pair}" is not level=perTradePkr:per24HoursPkr`);
    const [, level, perTrade, perDay] = match as unknown as [string, string, string, string];
    if (!LEVELS.includes(level as KycLevel)) {
      throw new Error(`KYC_LIMITS: unknown level "${level}" (use ${LEVELS.join(", ")})`);
    }
    if (found.has(level)) throw new Error(`KYC_LIMITS: "${level}" is given twice`);
    const limit = {
      perTradePaisa: BigInt(perTrade) * 100n,
      per24HoursPaisa: BigInt(perDay) * 100n,
    };
    if (limit.perTradePaisa === 0n || limit.per24HoursPaisa < limit.perTradePaisa) {
      throw new Error(
        `KYC_LIMITS: for "${level}", the 24-hour limit must be at least the per-trade limit, and neither zero`,
      );
    }
    found.set(level, limit);
  }
  const missing = LEVELS.filter((level) => !found.has(level));
  if (missing.length > 0) throw new Error(`KYC_LIMITS: no limit for ${missing.join(", ")}`);
  return Object.fromEntries(found) as KycLimits;
}

/** Why a purchase is over the customer's limit, or undefined when it is within it. */
export function overLimit(
  limit: KycLimit,
  purchasePaisa: bigint,
  boughtInLast24HoursPaisa: bigint,
): "per_trade" | "per_24_hours" | undefined {
  if (purchasePaisa > limit.perTradePaisa) return "per_trade";
  if (boughtInLast24HoursPaisa + purchasePaisa > limit.per24HoursPaisa) return "per_24_hours";
  return undefined;
}
