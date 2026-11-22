import { pricePerGramPaisa, valuePaisa, type PriceInputs } from "./pricing.js";
import type { QuoteRecord, TransactionRecord, WalletRecord } from "./types.js";

/**
 * A partner's analytics for the portal (GET /portal/v1/analytics, docs/portal-openapi.yaml).
 * Pure: everything comes in as records and comes out as bigint figures, so it is tested
 * without a chain (test/analytics.test.ts) and the route only formats the result.
 *
 * Units: grams in 1e-8 g, rupees in paisa, times in milliseconds since 1970.
 */

/** Pakistan Standard Time, UTC+05:00, no daylight saving: the partner's calendar day. */
const PKT_OFFSET_MS = 5 * 3_600_000;
const DAY_MS = 86_400_000;

export const ANALYTICS_PERIODS = [7, 30, 90] as const;
export type AnalyticsDays = (typeof ANALYTICS_PERIODS)[number];

/** Upper bounds of the ticket-size histogram, in rupees; the last bin has no upper bound. */
const TICKET_BOUNDS_PKR = [500n, 1_000n, 5_000n, 10_000n, 25_000n] as const;

export interface AnalyticsInput {
  partner: string;
  days: AnalyticsDays;
  /** Last day of the period, a Pakistan date "YYYY-MM-DD". */
  until: string;
  now: Date;
  /** The partner's wallets. */
  wallets: WalletRecord[];
  /** Every partner's transactions: a transfer from another partner adds to this one's custody. */
  transactions: TransactionRecord[];
  /** The partner's quotes. */
  quotes: QuoteRecord[];
  /** Every partner's quotes, for the price on each day. */
  priceQuotes: QuoteRecord[];
  currentPrice: PriceInputs;
}

export interface Change<T> {
  value: T;
  previous: T;
}

export interface PeriodFigures {
  custodyStart: bigint;
  custodyEnd: bigint;
  valueStart: bigint;
  valueEnd: bigint;
  boughtGrams: bigint;
  soldGrams: bigint;
  transferredInGrams: bigint;
  transferredOutGrams: bigint;
  boughtPaisa: bigint;
  soldPaisa: bigint;
  transferredInPaisa: bigint;
  transferredOutPaisa: bigint;
  priceEffectPaisa: bigint;
  netFlowGrams: bigint;
  volumePaisa: bigint;
  feesPaisa: bigint;
  trades: number;
  activeSavers: number;
  newSavers: number;
  registered: number;
  funded: number;
  funnel: {
    quotes: number;
    traded: number;
    failed: number;
    pending: number;
    expired: number;
    open: number;
    failureReasons: { code: string; count: number }[];
  };
  conversion: number | null;
  bandCancellationRate: number | null;
  settlement: { count: number; p50Ms: number | null; p95Ms: number | null; maxMs: number | null };
  tickets: {
    count: number;
    medianPaisa: bigint | null;
    meanPaisa: bigint | null;
    bins: { label: string; minPaisa: bigint; maxPaisa?: bigint; count: number }[];
  };
}

export interface DayFigures {
  date: string;
  boughtGrams: bigint;
  soldGrams: bigint;
  netGrams: bigint;
  custodyGrams: bigint;
  pricePerGramPaisa: bigint;
  trades: number;
}

export interface Analytics {
  partner: string;
  simulated: boolean;
  period: { from: string; until: string; days: number };
  previousPeriod: { from: string; until: string };
  pricePerGramPaisa: bigint;
  current: PeriodFigures;
  previous: PeriodFigures;
  series: DayFigures[];
}

// ---------------------------------------------------------------- calendar

/** Start of a Pakistan calendar day, as UTC milliseconds. */
export function dayStart(date: string): number {
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(ms) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new RangeError(`Not a date: ${date}`);
  }
  return ms - PKT_OFFSET_MS;
}

/** The Pakistan calendar date a moment falls on. */
export function pakistanDate(ms: number): string {
  return new Date(ms + PKT_OFFSET_MS).toISOString().slice(0, 10);
}

const addDays = (date: string, days: number) => pakistanDate(dayStart(date) + days * DAY_MS);
const time = (iso: string) => Date.parse(iso);

// ---------------------------------------------------------------- prices

/** Price at a moment: the last quote before it, the current price after `now`. */
function priceHistory(quotes: QuoteRecord[], current: PriceInputs, now: Date) {
  const points = quotes
    .map((q) => ({
      at: time(q.createdAt),
      price: { xauUsdE8: BigInt(q.xauUsdE8), usdPkrE4: BigInt(q.usdPkrE4) },
    }))
    .sort((a, b) => a.at - b.at);
  points.push({ at: now.getTime(), price: current });
  return (at: number): PriceInputs => {
    // Binary search for the last point at or before `at`; before the first, use the first.
    let lo = 0;
    let hi = points.length - 1;
    if (at < points[0]!.at) return points[0]!.price;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (points[mid]!.at <= at) lo = mid;
      else hi = mid - 1;
    }
    return points[lo]!.price;
  };
}

// ---------------------------------------------------------------- the ledger

interface Movement {
  at: number;
  walletId: string;
  /** Grams into (+) or out of (−) this partner's custody. */
  grams: bigint;
  kind: "buy" | "sell" | "in" | "out";
  /** Value at the price it traded at. */
  paisa: bigint;
}

/**
 * The confirmed movements of gold into and out of this partner's custody. A transfer between
 * two of its own customers moves nothing in or out, so it is left out.
 */
function movements(
  input: AnalyticsInput,
  own: Set<string>,
  quotes: Map<string, QuoteRecord>,
  priceAt: (at: number) => PriceInputs,
): Movement[] {
  const out: Movement[] = [];
  for (const t of input.transactions) {
    if (t.status !== "confirmed") continue;
    const at = time(t.confirmedAt ?? t.createdAt);
    const grams = BigInt(t.grams);
    const traded = () => {
      const q = t.quoteId ? quotes.get(t.quoteId) : undefined;
      return q ? BigInt(q.grossPaisa) : valuePaisa(grams, priceAt(at));
    };
    if (t.type === "mint" && own.has(t.walletId)) {
      out.push({ at, walletId: t.walletId, grams, kind: "buy", paisa: traded() });
    } else if (t.type === "burn" && own.has(t.walletId)) {
      out.push({ at, walletId: t.walletId, grams: -grams, kind: "sell", paisa: traded() });
    } else if (t.type === "transfer") {
      const from = own.has(t.walletId);
      const to = t.counterpartyWalletId !== undefined && own.has(t.counterpartyWalletId);
      if (from === to) continue;
      const paisa = t.valuePaisa ? BigInt(t.valuePaisa) : valuePaisa(grams, priceAt(at));
      if (from) out.push({ at, walletId: t.walletId, grams: -grams, kind: "out", paisa });
      else out.push({ at, walletId: t.counterpartyWalletId!, grams, kind: "in", paisa });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

// ---------------------------------------------------------------- statistics

/** Nearest-rank percentile of a sorted list (p in 0..100). */
export function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1]!;
}

/** Median of bigints: the mean of the two middle values for an even count, rounded down. */
export function medianBig(values: bigint[]): bigint | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2n;
}

const ratio = (part: number, whole: number) => (whole === 0 ? null : part / whole);

function ticketBins(paid: bigint[]) {
  const label = (lo: bigint, hi?: bigint) =>
    hi === undefined
      ? `Rs ${lo.toLocaleString("en")}+`
      : `Rs ${lo.toLocaleString("en")}–${hi.toLocaleString("en")}`;
  const bins: { label: string; minPaisa: bigint; maxPaisa?: bigint; count: number }[] = [];
  let lo = 0n;
  for (const hi of TICKET_BOUNDS_PKR) {
    bins.push({ label: label(lo, hi), minPaisa: lo * 100n, maxPaisa: hi * 100n, count: 0 });
    lo = hi;
  }
  bins.push({ label: label(lo), minPaisa: lo * 100n, count: 0 });
  for (const p of paid) {
    const bin = bins.find((b) => b.maxPaisa === undefined || p < b.maxPaisa)!;
    bin.count += 1;
  }
  return bins;
}

// ---------------------------------------------------------------- one period

function periodFigures(
  input: AnalyticsInput,
  start: number,
  end: number,
  ledger: Movement[],
  quoteMap: Map<string, QuoteRecord>,
  txnMap: Map<string, TransactionRecord>,
  own: Set<string>,
  priceAt: (at: number) => PriceInputs,
): PeriodFigures {
  const custodyAt = (at: number) =>
    ledger.reduce((sum, m) => (m.at < at ? sum + m.grams : sum), 0n);
  const custodyStart = custodyAt(start);
  const custodyEnd = custodyAt(end);
  // A period that is still running is valued at the price now, not at its future end.
  const endPriceAt = Math.min(end, input.now.getTime());
  const valueStart = valuePaisa(custodyStart, priceAt(start));
  const valueEnd = valuePaisa(custodyEnd, priceAt(endPriceAt));

  const inPeriod = ledger.filter((m) => m.at >= start && m.at < end);
  const sum = (kind: Movement["kind"], field: "grams" | "paisa") =>
    inPeriod
      .filter((m) => m.kind === kind)
      .reduce(
        (s, m) => s + (field === "grams" ? (m.grams < 0n ? -m.grams : m.grams) : m.paisa),
        0n,
      );
  const boughtGrams = sum("buy", "grams");
  const soldGrams = sum("sell", "grams");
  const transferredInGrams = sum("in", "grams");
  const transferredOutGrams = sum("out", "grams");
  const boughtPaisa = sum("buy", "paisa");
  const soldPaisa = sum("sell", "paisa");
  const transferredInPaisa = sum("in", "paisa");
  const transferredOutPaisa = sum("out", "paisa");

  // Trades: this partner's own buys and sales, by when they were asked for.
  const ownTrades = input.transactions.filter(
    (t) => own.has(t.walletId) && (t.type === "mint" || t.type === "burn"),
  );
  const askedIn = (t: TransactionRecord) => time(t.createdAt) >= start && time(t.createdAt) < end;
  const confirmedTrades = ownTrades.filter((t) => t.status === "confirmed" && askedIn(t));
  const finished = ownTrades.filter(
    (t) => (t.status === "confirmed" || t.status === "failed") && askedIn(t),
  );
  const bandFailures = finished.filter(
    (t) => t.status === "failed" && t.failureCode === "price_moved",
  );

  let volumePaisa = 0n;
  let feesPaisa = 0n;
  for (const t of confirmedTrades) {
    volumePaisa += BigInt(t.netPaisa ?? "0");
    const q = t.quoteId ? quoteMap.get(t.quoteId) : undefined;
    if (q) feesPaisa += BigInt(q.fxMarginPaisa) + BigInt(q.platformFeePaisa);
  }

  // Savers.
  const active = new Set(
    input.transactions
      .filter(
        (t) =>
          t.status === "confirmed" &&
          own.has(t.walletId) &&
          time(t.confirmedAt ?? t.createdAt) >= start &&
          time(t.confirmedAt ?? t.createdAt) < end,
      )
      .map((t) => t.walletId),
  );
  const firstBuy = new Map<string, number>();
  for (const m of ledger) {
    if (m.kind === "buy" && !firstBuy.has(m.walletId)) firstBuy.set(m.walletId, m.at);
  }
  const newSavers = [...firstBuy.values()].filter((at) => at >= start && at < end).length;
  const registered = input.wallets.filter((w) => time(w.createdAt) < end).length;
  const balances = new Map<string, bigint>();
  for (const m of ledger) {
    if (m.at < end) balances.set(m.walletId, (balances.get(m.walletId) ?? 0n) + m.grams);
  }
  const funded = [...balances.values()].filter((g) => g > 0n).length;

  // Quotes given in the period, and what became of them.
  const quotes = input.quotes.filter((q) => time(q.createdAt) >= start && time(q.createdAt) < end);
  const reasons = new Map<string, number>();
  const funnel = { quotes: quotes.length, traded: 0, failed: 0, pending: 0, expired: 0, open: 0 };
  for (const q of quotes) {
    const t = q.usedByTransactionId ? txnMap.get(q.usedByTransactionId) : undefined;
    if (t?.status === "confirmed") funnel.traded += 1;
    else if (t?.status === "failed") {
      funnel.failed += 1;
      const code = t.failureCode ?? "unknown";
      reasons.set(code, (reasons.get(code) ?? 0) + 1);
    } else if (t) funnel.pending += 1;
    else if (time(q.expiresAt) <= Math.min(end, input.now.getTime())) funnel.expired += 1;
    else funnel.open += 1;
  }

  // Settlement time of buys and sales confirmed in the period.
  const durations = ownTrades
    .filter(
      (t) =>
        t.status === "confirmed" &&
        t.confirmedAt !== undefined &&
        time(t.confirmedAt) >= start &&
        time(t.confirmedAt) < end,
    )
    .map((t) => Math.max(0, time(t.confirmedAt!) - time(t.createdAt)))
    .sort((a, b) => a - b);

  const paid = confirmedTrades
    .filter((t) => t.type === "mint")
    .map((t) => BigInt(t.netPaisa ?? "0"));

  return {
    custodyStart,
    custodyEnd,
    valueStart,
    valueEnd,
    boughtGrams,
    soldGrams,
    transferredInGrams,
    transferredOutGrams,
    boughtPaisa,
    soldPaisa,
    transferredInPaisa,
    transferredOutPaisa,
    priceEffectPaisa:
      valueEnd - valueStart - boughtPaisa + soldPaisa - transferredInPaisa + transferredOutPaisa,
    netFlowGrams: boughtGrams - soldGrams + transferredInGrams - transferredOutGrams,
    volumePaisa,
    feesPaisa,
    trades: confirmedTrades.length,
    activeSavers: active.size,
    newSavers,
    registered,
    funded,
    funnel: {
      ...funnel,
      failureReasons: [...reasons]
        .map(([code, count]) => ({ code, count }))
        .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code)),
    },
    conversion: ratio(funnel.traded, funnel.quotes),
    bandCancellationRate: ratio(bandFailures.length, finished.length),
    settlement: {
      count: durations.length,
      p50Ms: percentile(durations, 50),
      p95Ms: percentile(durations, 95),
      maxMs: durations.at(-1) ?? null,
    },
    tickets: {
      count: paid.length,
      medianPaisa: medianBig(paid),
      meanPaisa: paid.length ? paid.reduce((s, p) => s + p, 0n) / BigInt(paid.length) : null,
      bins: ticketBins(paid),
    },
  };
}

// ---------------------------------------------------------------- the whole answer

export function computeAnalytics(input: AnalyticsInput): Analytics {
  const own = new Set(input.wallets.map((w) => w.id));
  const quoteMap = new Map(input.quotes.map((q) => [q.id, q]));
  const txnMap = new Map(input.transactions.map((t) => [t.id, t]));
  const priceAt = priceHistory(input.priceQuotes, input.currentPrice, input.now);
  const ledger = movements(input, own, quoteMap, priceAt);

  const from = addDays(input.until, -(input.days - 1));
  const start = dayStart(from);
  const end = dayStart(addDays(input.until, 1));
  const previousFrom = addDays(from, -input.days);
  const previousStart = dayStart(previousFrom);

  const figures = (a: number, b: number) =>
    periodFigures(input, a, b, ledger, quoteMap, txnMap, own, priceAt);
  const current = figures(start, end);
  const previous = figures(previousStart, start);

  const series: DayFigures[] = [];
  let custody = current.custodyStart;
  let cursor = 0;
  while (cursor < ledger.length && ledger[cursor]!.at < start) cursor += 1;
  for (let day = 0; day < input.days; day += 1) {
    const date = addDays(from, day);
    const a = dayStart(date);
    const b = a + DAY_MS;
    let bought = 0n;
    let sold = 0n;
    let net = 0n;
    while (cursor < ledger.length && ledger[cursor]!.at < b) {
      const m = ledger[cursor]!;
      if (m.kind === "buy") bought += m.grams;
      if (m.kind === "sell") sold -= m.grams;
      net += m.grams;
      cursor += 1;
    }
    custody += net;
    const trades = input.transactions.filter(
      (t) =>
        own.has(t.walletId) &&
        (t.type === "mint" || t.type === "burn") &&
        t.status === "confirmed" &&
        time(t.createdAt) >= a &&
        time(t.createdAt) < b,
    ).length;
    series.push({
      date,
      boughtGrams: bought,
      soldGrams: sold,
      netGrams: net,
      custodyGrams: custody,
      pricePerGramPaisa: pricePerGramPaisa(priceAt(Math.min(b - 1, input.now.getTime()))),
      trades,
    });
  }

  const simulated =
    input.wallets.length > 0 &&
    input.wallets.every((w) => w.simulated) &&
    input.quotes.every((q) => q.simulated);

  return {
    partner: input.partner,
    simulated,
    period: { from, until: input.until, days: input.days },
    previousPeriod: { from: previousFrom, until: addDays(from, -1) },
    pricePerGramPaisa: pricePerGramPaisa(priceAt(Math.min(end - 1, input.now.getTime()))),
    current,
    previous,
    series,
  };
}
