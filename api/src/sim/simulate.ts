import type { KycLevel, KycLimits } from "../domain/kyc-limits.js";
import {
  computeQuote,
  QuoteTooSmallError,
  type FeeRates,
  type PriceInputs,
  type QuoteAmount,
} from "../domain/pricing.js";
import type { QuoteRecord, TransactionRecord, WalletRecord } from "../domain/types.js";
import { newId } from "../lib/ids.js";

/**
 * Simulated history for the partner portal's analytics (GET /portal/v1/analytics), so its
 * charts have months of activity to show in a demo. Everything written here is marked
 * `simulated: true`, goes to a partner whose slug starts with "sim-", and never touches the
 * chain. The portal says "Simulated data" on every chart for such a partner.
 *
 * The model is deliberately simple and seeded (the same seed gives the same history; only the
 * record ids differ), and every number in it is stated below:
 *
 * - Gold price: a random walk of daily returns with 18% annual volatility (the top of gold's
 *   usual 10–18% range), no drift, ending at today's real price so today joins up with it.
 * - Sign-ups: spread over the period, rising towards today (the programme is growing).
 * - Four kinds of saver, as the partner portal research doc describes:
 *     habit       45%  buys every 7–14 days, median Rs 2,000
 *     occasional  35%  buys every 20–40 days, median Rs 5,000
 *     large       10%  buys every 25–35 days, median Rs 25,000
 *     dormant     10%  60% never buy at all
 *   Amounts are log-normal around the median, rounded to Rs 100, and kept within the
 *   customer's KYC limits. After each purchase a saver stops for good with chance 3%.
 * - First purchase: within 7 days of sign-up for 80% of savers, later for the rest.
 * - Sales: each week a saver with gold sells 20–60% of it (or all, 15% of the time) with
 *   chance 4%, doubled after the price has risen more than 3% in a week (taking profit).
 * - Quotes: 10% expire unused (half of those ask again a few minutes later); 0.4% fail
 *   because the price moved past the 0.5% band, more on volatile days, and 70% of those
 *   customers ask again. The rest confirm.
 * - Settlement time: log-normal, median 2.4 s, so the 95th percentile is about 5 s.
 * - Time of day: 9 am to 11 pm in Pakistan, busiest in the evening.
 */

export interface SimulationOptions {
  partner: string;
  savers: number;
  days: number;
  seed: number;
  now: Date;
  /** Today's real price; the walk ends here. */
  endPrice: PriceInputs;
  fees: FeeRates;
  limits: KycLimits;
}

export interface SimulatedHistory {
  wallets: WalletRecord[];
  quotes: QuoteRecord[];
  transactions: TransactionRecord[];
}

export const SIMULATED_PREFIX = "sim-";

/** A partner that only ever holds simulated history. */
export function isSimulatedPartner(slug: string): boolean {
  return slug.startsWith(SIMULATED_PREFIX);
}

const DAY_MS = 86_400_000;
const PKT_OFFSET_MS = 5 * 3_600_000;
const ANNUAL_VOLATILITY = 0.18;

type Kind = "habit" | "occasional" | "large" | "dormant";
const KINDS: { kind: Kind; share: number; everyDays: [number, number]; medianPkr: number }[] = [
  { kind: "habit", share: 0.45, everyDays: [7, 14], medianPkr: 2_000 },
  { kind: "occasional", share: 0.35, everyDays: [20, 40], medianPkr: 5_000 },
  { kind: "large", share: 0.1, everyDays: [25, 35], medianPkr: 25_000 },
  { kind: "dormant", share: 0.1, everyDays: [20, 40], medianPkr: 3_000 },
];
const KYC: { level: KycLevel; share: number }[] = [
  { level: "asaan", share: 0.5 },
  { level: "standard", share: 0.45 },
  { level: "enhanced", share: 0.05 },
];

/** Mulberry32: small, fast, and the same numbers for the same seed on every machine. */
function generator(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
  const normal = () => {
    const u = Math.max(next(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
  };
  return {
    next,
    normal,
    chance: (p: number) => next() < p,
    between: (lo: number, hi: number) => lo + next() * (hi - lo),
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    pick<T extends { share: number }>(options: T[]): T {
      let r = next();
      for (const o of options) {
        if ((r -= o.share) < 0) return o;
      }
      return options.at(-1)!;
    },
  };
}

export function simulateHistory(o: SimulationOptions): SimulatedHistory {
  if (!isSimulatedPartner(o.partner)) {
    throw new Error(`Simulated history only goes to a "${SIMULATED_PREFIX}" partner`);
  }
  const rng = generator(o.seed);
  const now = o.now.getTime();
  // Day 0 is the first day of the history, day `o.days` is today (Pakistan calendar).
  const todayStart = Math.floor((now + PKT_OFFSET_MS) / DAY_MS) * DAY_MS - PKT_OFFSET_MS;
  const dayStart = (day: number) => todayStart - (o.days - day) * DAY_MS;

  // Gold price per ounce for each day, walking back from today's.
  const sigma = ANNUAL_VOLATILITY / Math.sqrt(365);
  const xau: number[] = new Array<number>(o.days + 1);
  xau[o.days] = Number(o.endPrice.xauUsdE8);
  for (let d = o.days - 1; d >= 0; d -= 1) {
    xau[d] = xau[d + 1]! / Math.exp(sigma * rng.normal() - (sigma * sigma) / 2);
  }
  const dailyMove = (day: number) => (day === 0 ? 0 : Math.abs(xau[day]! / xau[day - 1]! - 1));
  const weekRise = (day: number) => (day < 7 ? 0 : xau[day]! / xau[day - 7]! - 1);
  const priceOn = (day: number): PriceInputs => ({
    // Small moves within the day, so quotes on one day are not all identical.
    xauUsdE8: BigInt(Math.round(xau[day]! * (1 + rng.between(-0.0015, 0.0015)))),
    usdPkrE4: o.endPrice.usdPkrE4,
  });

  // A moment on a day: 9 am to 11 pm, busiest in the evening.
  const momentOn = (day: number) => {
    const hour = 9 + 14 * Math.sqrt(rng.next());
    return dayStart(day) + Math.floor(hour * 3_600_000);
  };

  const wallets: WalletRecord[] = [];
  const quotes: QuoteRecord[] = [];
  const transactions: TransactionRecord[] = [];
  const iso = (ms: number) => new Date(ms).toISOString();

  /**
   * One request for a price, and what the customer did with it. Returns the grams that moved
   * and when the trade settled (0n and the request time if nothing moved).
   */
  function attempt(
    wallet: WalletRecord,
    side: "buy" | "sell",
    amount: QuoteAmount,
    day: number,
    at: number,
    retriesLeft = 1,
  ): { grams: bigint; at: number } {
    const none = { grams: 0n, at };
    if (at >= now) return none;
    const price = priceOn(day);
    let math;
    try {
      math = computeQuote(side, amount, price, o.fees);
    } catch (error) {
      if (error instanceof QuoteTooSmallError) return none;
      throw error;
    }
    const quote: QuoteRecord = {
      id: newId("qt"),
      partnerSlug: o.partner,
      walletId: wallet.id,
      side,
      grams: math.grams.toString(),
      grossPaisa: math.grossPaisa.toString(),
      netPaisa: math.netPaisa.toString(),
      fxMarginPaisa: math.fxMarginPaisa.toString(),
      platformFeePaisa: math.platformFeePaisa.toString(),
      xauUsdE8: price.xauUsdE8.toString(),
      usdPkrE4: price.usdPkrE4.toString(),
      priceUpdatedAt: iso(at),
      priceSource: "mock",
      expiresAt: iso(at + 60_000),
      createdAt: iso(at),
      simulated: true,
    };
    quotes.push(quote);

    const bandFailure = Math.min(0.05, 0.004 + 2 * Math.max(0, dailyMove(day) - 0.01));
    const roll = rng.next();
    if (roll < 0.1) {
      // Expired unused; half ask again a few minutes later.
      if (retriesLeft > 0 && rng.chance(0.5)) {
        return attempt(wallet, side, amount, day, at + rng.int(2, 10) * 60_000, retriesLeft - 1);
      }
      return none;
    }
    const createdAt = at + rng.int(5, 40) * 1_000;
    if (createdAt >= now) return none;
    const txn: TransactionRecord = {
      id: newId("txn"),
      partnerSlug: o.partner,
      type: side === "buy" ? "mint" : "burn",
      status: "confirmed",
      walletId: wallet.id,
      grams: math.grams.toString(),
      quoteId: quote.id,
      netPaisa: math.netPaisa.toString(),
      createdAt: iso(createdAt),
      simulated: true,
    };
    quote.usedByTransactionId = txn.id;
    if (roll < 0.1 + bandFailure) {
      txn.status = "failed";
      txn.failureCode = "price_moved";
      txn.failureMessage = "The gold price moved more than 0.5% before the trade settled.";
      transactions.push(txn);
      if (retriesLeft > 0 && rng.chance(0.7)) {
        return attempt(
          wallet,
          side,
          amount,
          day,
          createdAt + rng.int(1, 5) * 60_000,
          retriesLeft - 1,
        );
      }
      return none;
    }
    const settleMs = Math.round(2_400 * Math.exp(0.45 * rng.normal()));
    const settled = Math.min(createdAt + settleMs, now - 1);
    txn.confirmedAt = iso(settled);
    txn.blockNumber = 0;
    transactions.push(txn);
    return { grams: math.grams, at: settled };
  }

  for (let i = 0; i < o.savers; i += 1) {
    const kind = rng.pick(KINDS);
    const level = rng.pick(KYC).level;
    const limit = o.limits[level];
    // Sign-ups rise towards today: density (0.4 + 0.6 t) / 0.7 on [0, 1], drawn by inverting
    // its CDF (0.4 t + 0.3 t²) / 0.7 = u. Dividing by 0.7 matters: without it t overshoots 1
    // for 30% of draws, which all landed on today.
    const t = (-0.4 + Math.sqrt(0.16 + 0.84 * rng.next())) / 0.6;
    const joined = Math.min(o.days, Math.floor(t * o.days));
    const joinedAt = momentOn(joined);
    if (joinedAt >= now) continue;
    const wallet: WalletRecord = {
      id: newId("wal"),
      partnerSlug: o.partner,
      externalCustomerId: `SIM-${String(i + 1).padStart(4, "0")}`,
      address: `0x${Array.from({ length: 40 }, () => rng.int(0, 15).toString(16)).join("")}`,
      kycLevel: level,
      kycAttestationHash: `0x${"0".repeat(64)}`,
      derivationIndex: -1,
      createdAt: iso(joinedAt),
      simulated: true,
    };
    wallets.push(wallet);
    if (kind.kind === "dormant" && rng.chance(0.6)) continue;

    let holding = 0n;
    /** When this saver's last trade settled: the next one always comes after it. */
    let lastSettled = joinedAt;
    let active = true;
    let nextBuy = joined + (rng.chance(0.8) ? rng.int(0, 7) : rng.int(8, 30));
    const sellWeekday = rng.int(0, 6);
    const spent: { day: number; paisa: bigint }[] = [];
    for (let day = joined; day <= o.days; day += 1) {
      if (active && day >= nextBuy) {
        const rupees = Math.max(
          100,
          Math.round((kind.medianPkr * Math.exp(0.6 * rng.normal())) / 100) * 100,
        );
        const used30 = spent.filter((s) => s.day > day - 30).reduce((s, x) => s + x.paisa, 0n);
        const allowed = [limit.perTradePaisa, limit.per30DaysPaisa - used30];
        const paisa = allowed.reduce((m, x) => (x < m ? x : m), BigInt(rupees) * 100n);
        if (paisa >= 10_000n) {
          const at = Math.max(momentOn(day), lastSettled + 60_000);
          const bought = attempt(wallet, "buy", { amountPaisa: paisa }, day, at);
          if (bought.grams > 0n) {
            holding += bought.grams;
            lastSettled = bought.at;
            spent.push({ day, paisa });
            if (rng.chance(0.03)) active = false;
          }
        }
        const [lo, hi] = kind.everyDays;
        nextBuy = day + rng.int(lo, hi);
      }
      if (holding > 0n && day % 7 === sellWeekday && day > joined) {
        const p = 0.04 * (weekRise(day) > 0.03 ? 2 : 1);
        if (rng.chance(p)) {
          const share = rng.chance(0.15) ? 1 : rng.between(0.2, 0.6);
          const grams =
            share === 1 ? holding : (holding * BigInt(Math.round(share * 1000))) / 1000n;
          if (grams > 0n) {
            const at = Math.max(momentOn(day), lastSettled + 60_000);
            const sold = attempt(wallet, "sell", { grams }, day, at);
            if (sold.grams > 0n) {
              holding -= sold.grams;
              lastSettled = sold.at;
            }
          }
        }
      }
    }
  }
  return { wallets, quotes, transactions };
}
