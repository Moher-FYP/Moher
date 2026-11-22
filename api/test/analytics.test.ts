import request from "supertest";
import { describe, expect, it } from "vitest";
import {
  computeAnalytics,
  dayStart,
  medianBig,
  pakistanDate,
  percentile,
  type AnalyticsInput,
} from "../src/domain/analytics.js";
import type { QuoteRecord, TransactionRecord, WalletRecord } from "../src/domain/types.js";
import { setup } from "./portal-fixture.js";

/** Rs 10,000 per gram, then Rs 11,000 per gram (USD 1 = Rs 1 keeps the arithmetic plain). */
const PRICE_A = { xauUsdE8: 31_103_500_000_000n, usdPkrE4: 10_000n };
const PRICE_B = { xauUsdE8: 34_213_850_000_000n, usdPkrE4: 10_000n };
const GRAM = 100_000_000n;
const UNTIL = "2026-11-20";
/** Noon in Pakistan on a day relative to UNTIL (0 = UNTIL itself). */
const at = (day: number, minutes = 0) =>
  new Date(dayStart(UNTIL) + day * 86_400_000 + 12 * 3_600_000 + minutes * 60_000).toISOString();

const wallet = (id: string, partnerSlug: string, day: number): WalletRecord => ({
  id,
  partnerSlug,
  externalCustomerId: id,
  address: `0x${"0".repeat(40)}`,
  kycLevel: "standard",
  kycAttestationHash: `0x${"0".repeat(64)}`,
  derivationIndex: 0,
  createdAt: at(day),
});

let n = 0;
function quote(
  partnerSlug: string,
  walletId: string,
  side: "buy" | "sell",
  grams: bigint,
  price: typeof PRICE_A,
  createdAt: string,
): QuoteRecord {
  const perGram = price === PRICE_A ? 1_000_000n : 1_100_000n;
  const gross = (grams * perGram) / GRAM;
  const margin = gross / 400n; // 0.25%
  return {
    id: `qte_${++n}`,
    partnerSlug,
    walletId,
    side,
    grams: grams.toString(),
    grossPaisa: gross.toString(),
    netPaisa: (side === "buy" ? gross + margin : gross - margin).toString(),
    fxMarginPaisa: margin.toString(),
    platformFeePaisa: (gross / 200n).toString(),
    xauUsdE8: price.xauUsdE8.toString(),
    usdPkrE4: price.usdPkrE4.toString(),
    priceUpdatedAt: createdAt,
    priceSource: "mock",
    expiresAt: new Date(Date.parse(createdAt) + 60_000).toISOString(),
    createdAt,
  };
}

function trade(
  q: QuoteRecord,
  status: TransactionRecord["status"],
  settleMs = 2_000,
  failureCode?: string,
): TransactionRecord {
  q.usedByTransactionId = `txn_${q.id}`;
  const createdAt = new Date(Date.parse(q.createdAt) + 5_000).toISOString();
  return {
    id: `txn_${q.id}`,
    partnerSlug: q.partnerSlug,
    type: q.side === "buy" ? "mint" : "burn",
    status,
    walletId: q.walletId,
    grams: q.grams,
    quoteId: q.id,
    netPaisa: q.netPaisa,
    createdAt,
    ...(status === "confirmed"
      ? { confirmedAt: new Date(Date.parse(createdAt) + settleMs).toISOString() }
      : {}),
    ...(failureCode ? { failureCode } : {}),
  };
}

function transfer(
  from: string,
  to: string,
  partnerSlug: string,
  grams: bigint,
  createdAt: string,
): TransactionRecord {
  return {
    id: `txn_t${++n}`,
    partnerSlug,
    type: "transfer",
    status: "confirmed",
    walletId: from,
    counterpartyWalletId: to,
    grams: grams.toString(),
    valuePaisa: ((grams * 1_100_000n) / GRAM).toString(),
    createdAt,
    confirmedAt: createdAt,
  };
}

/**
 * Bank customers w1 and w2; wallet x1 belongs to another partner. In the 7-day period ending
 * UNTIL: w1 buys 1 g at Rs 10,000 (bought 1 g a week earlier too), the price rises to
 * Rs 11,000, w2 buys 0.5 g, w1 sells 0.25 g, w1 sends 0.1 g to w2 (inside the bank: no flow)
 * and x1 sends 0.2 g in from the other partner.
 */
function scenario(): AnalyticsInput {
  const w1 = wallet("wal_w1", "bank", -20);
  const w2 = wallet("wal_w2", "bank", -3);
  const x1 = wallet("wal_x1", "other", -20);
  const q0 = quote("bank", w1.id, "buy", GRAM, PRICE_A, at(-9)); // previous period
  const q1 = quote("bank", w1.id, "buy", GRAM, PRICE_A, at(-6));
  const q2 = quote("bank", w2.id, "buy", GRAM / 2n, PRICE_B, at(-2));
  const q3 = quote("bank", w1.id, "sell", GRAM / 4n, PRICE_B, at(-1));
  const q4 = quote("bank", w2.id, "buy", GRAM, PRICE_B, at(-1, 30)); // fails: price moved
  const q5 = quote("bank", w2.id, "buy", GRAM, PRICE_B, at(-1, 60)); // expires unused
  const qx = quote("other", x1.id, "buy", GRAM, PRICE_A, at(-8));
  const transactions = [
    trade(q0, "confirmed"),
    trade(q1, "confirmed", 2_000),
    trade(q2, "confirmed", 4_000),
    trade(q3, "confirmed", 6_000),
    trade(q4, "failed", 0, "price_moved"),
    trade(qx, "confirmed"),
    transfer(w1.id, w2.id, "bank", GRAM / 10n, at(0, -60)),
    transfer(x1.id, w1.id, "other", GRAM / 5n, at(0, -30)),
  ];
  const quotes = [q0, q1, q2, q3, q4, q5];
  return {
    partner: "bank",
    days: 7,
    until: UNTIL,
    now: new Date(at(0, 60)),
    wallets: [w1, w2],
    transactions,
    quotes,
    priceQuotes: [...quotes, qx],
    currentPrice: PRICE_B,
  };
}

describe("calendar", () => {
  it("uses Pakistan days (UTC+05:00)", () => {
    expect(new Date(dayStart("2026-11-20")).toISOString()).toBe("2026-11-19T19:00:00.000Z");
    expect(pakistanDate(Date.parse("2026-11-19T19:30:00Z"))).toBe("2026-11-20");
    expect(pakistanDate(Date.parse("2026-11-19T18:59:59Z"))).toBe("2026-11-19");
  });
});

describe("statistics", () => {
  it("takes nearest-rank percentiles and a median that works for even counts", () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([1, 2, 3, 4], 50)).toBe(2);
    expect(percentile([1, 2, 3, 4], 95)).toBe(4);
    expect(medianBig([5n, 1n, 3n])).toBe(3n);
    expect(medianBig([1n, 2n, 3n, 10n])).toBe(2n);
  });
});

describe("analytics", () => {
  const a = computeAnalytics(scenario());
  const f = a.current;

  it("rebuilds custody from confirmed trades and transfers between partners", () => {
    // Previous: 1 g. Period: +1 +0.5 −0.25 +0.2 (inside transfer moves nothing).
    expect(f.custodyStart).toBe(GRAM);
    expect(f.custodyEnd).toBe(GRAM + GRAM + GRAM / 2n - GRAM / 4n + GRAM / 5n);
    expect(f.netFlowGrams).toBe(f.custodyEnd - f.custodyStart);
    expect(f.transferredInGrams).toBe(GRAM / 5n);
    expect(f.transferredOutGrams).toBe(0n);
  });

  it("splits the change in value into flows and the price effect", () => {
    const closing =
      f.valueStart +
      f.boughtPaisa -
      f.soldPaisa +
      f.transferredInPaisa -
      f.transferredOutPaisa +
      f.priceEffectPaisa;
    expect(closing).toBe(f.valueEnd);
    // Opening 1 g at Rs 10,000; closing 2.45 g at Rs 11,000.
    expect(f.valueStart).toBe(1_000_000n);
    expect(f.valueEnd).toBe(2_695_000n);
    // Gains: 1 g held from Rs 10,000 to 11,000, and the 1 g bought at Rs 10,000.
    expect(f.priceEffectPaisa).toBe(200_000n);
  });

  it("follows each quote to its outcome", () => {
    expect(f.funnel).toMatchObject({ quotes: 5, traded: 3, failed: 1, pending: 0, expired: 1 });
    expect(f.funnel.failureReasons).toEqual([{ code: "price_moved", count: 1 }]);
    expect(f.conversion).toBeCloseTo(3 / 5);
    expect(f.bandCancellationRate).toBeCloseTo(1 / 4);
  });

  it("counts trades, volume, fees, savers and settlement time", () => {
    expect(f.trades).toBe(3);
    expect(f.activeSavers).toBe(2);
    expect(f.newSavers).toBe(1); // w2; w1 first bought in the previous period
    expect(f.registered).toBe(2);
    expect(f.funded).toBe(2);
    expect(f.settlement).toEqual({ count: 3, p50Ms: 4_000, p95Ms: 6_000, maxMs: 6_000 });
    expect(f.tickets.count).toBe(2);
    expect(f.tickets.bins.find((b) => b.label === "Rs 5,000–10,000")?.count).toBe(1);
    expect(f.tickets.bins.find((b) => b.label === "Rs 10,000–25,000")?.count).toBe(1);
    // 0.25% margin + 0.5% platform fee on trades worth Rs 10,000, 5,500 and 2,750.
    expect(f.feesPaisa).toBe(2_500n + 1_375n + 687n + 5_000n + 2_750n + 1_375n);
  });

  it("gives the same figures for the period before, for comparison", () => {
    expect(a.previous.boughtGrams).toBe(GRAM);
    expect(a.previous.trades).toBe(1);
    expect(a.previous.custodyEnd).toBe(a.current.custodyStart);
    expect(a.previousPeriod).toEqual({ from: "2026-11-07", until: "2026-11-13" });
  });

  it("draws one point per day that ends at the period's custody", () => {
    expect(a.series).toHaveLength(7);
    expect(a.series[0]!.date).toBe("2026-11-14");
    expect(a.series.at(-1)!.custodyGrams).toBe(f.custodyEnd);
    expect(a.series.reduce((s, d) => s + d.netGrams, 0n)).toBe(f.netFlowGrams);
    expect(a.series.at(-1)!.pricePerGramPaisa).toBe(1_100_000n);
    expect(a.simulated).toBe(false);
  });

  it("says so when every record is simulated", () => {
    const input = scenario();
    input.wallets = input.wallets.map((w) => ({ ...w, simulated: true as const }));
    input.quotes = input.quotes.map((q) => ({ ...q, simulated: true as const }));
    expect(computeAnalytics(input).simulated).toBe(true);
  });
});

describe("GET /portal/v1/analytics", () => {
  it("answers for the signed-in partner only, in the spec's units", async () => {
    const { app, signIn } = await setup();
    const cookie = await signIn("viewer@bank.test");
    const res = await request(app).get("/portal/v1/analytics?days=7").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.partner).toBe("demo-bank");
    expect(res.body.period.days).toBe(7);
    expect(res.body.series).toHaveLength(7);
    expect(res.body.tiles.custodyGrams.value).toMatch(/^\d+\.\d{8}$/);
    expect(res.body.bridge.priceEffectPkr).toMatch(/^-?\d+\.\d{2}$/);
    expect(res.body.reserve).toEqual({ backingRatio: 1, asOf: expect.any(String) });
  });

  it("refuses an unknown period or a future day", async () => {
    const { app, signIn } = await setup();
    const cookie = await signIn("viewer@bank.test");
    for (const path of ["?days=14", "?until=2999-01-01", "?until=yesterday"]) {
      const res = await request(app).get(`/portal/v1/analytics${path}`).set("Cookie", cookie);
      expect(res.status).toBe(400);
    }
  });

  it("is closed to operators, who have no partner", async () => {
    const { app, signIn } = await setup();
    const cookie = await signIn("ops@mohar.test");
    expect((await request(app).get("/portal/v1/analytics").set("Cookie", cookie)).status).toBe(403);
  });
});
