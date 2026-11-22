import { describe, expect, it } from "vitest";
import { computeAnalytics, pakistanDate } from "../src/domain/analytics.js";
import { DEFAULT_KYC_LIMITS, parseKycLimits } from "../src/domain/kyc-limits.js";
import { simulateHistory, type SimulationOptions } from "../src/sim/simulate.js";
import { Store } from "../src/store/store.js";

const NOW = new Date("2026-11-22T17:00:00Z");
const PRICE = { xauUsdE8: 399_120_000_000n, usdPkrE4: 2_766_000n };

const options = (overrides: Partial<SimulationOptions> = {}): SimulationOptions => ({
  partner: "sim-bank",
  savers: 150,
  days: 90,
  seed: 7,
  now: NOW,
  endPrice: PRICE,
  fees: { platformFeeBps: 50n, fxMarginBps: 25n },
  limits: parseKycLimits(DEFAULT_KYC_LIMITS),
  ...overrides,
});

describe("simulated history", () => {
  const history = simulateHistory(options());

  it("gives the same history for the same seed", () => {
    const again = simulateHistory(options());
    expect(again.wallets.length).toBe(history.wallets.length);
    expect(again.transactions.map((t) => [t.type, t.status, t.grams, t.createdAt])).toEqual(
      history.transactions.map((t) => [t.type, t.status, t.grams, t.createdAt]),
    );
    expect(simulateHistory(options({ seed: 8 })).transactions.length).not.toBe(
      history.transactions.length,
    );
  });

  it("marks every record simulated and keeps it in the past", () => {
    const all = [...history.wallets, ...history.quotes, ...history.transactions];
    expect(all.every((r) => r.simulated && r.partnerSlug === "sim-bank")).toBe(true);
    expect(all.every((r) => Date.parse(r.createdAt) < NOW.getTime())).toBe(true);
    expect(
      history.transactions.every(
        (t) => !t.confirmedAt || Date.parse(t.confirmedAt) < NOW.getTime(),
      ),
    ).toBe(true);
  });

  it("never sells more gold than a saver holds, and keeps buys within KYC limits", () => {
    const limits = parseKycLimits(DEFAULT_KYC_LIMITS);
    const level = new Map(history.wallets.map((w) => [w.id, w.kycLevel]));
    const held = new Map<string, bigint>();
    const confirmed = history.transactions
      .filter((t) => t.status === "confirmed")
      .sort((a, b) => a.confirmedAt!.localeCompare(b.confirmedAt!));
    for (const t of confirmed) {
      const change = t.type === "mint" ? BigInt(t.grams) : -BigInt(t.grams);
      const after = (held.get(t.walletId) ?? 0n) + change;
      expect(after).toBeGreaterThanOrEqual(0n);
      held.set(t.walletId, after);
      if (t.type === "mint") {
        expect(BigInt(t.netPaisa!)).toBeLessThanOrEqual(
          limits[level.get(t.walletId)!].perTradePaisa,
        );
      }
    }
  });

  it("produces figures in the ranges its model states", () => {
    const a = computeAnalytics({
      partner: "sim-bank",
      days: 30,
      until: pakistanDate(NOW.getTime()),
      now: NOW,
      wallets: history.wallets,
      transactions: history.transactions,
      quotes: history.quotes,
      priceQuotes: history.quotes,
      currentPrice: PRICE,
    }).current;
    expect(a.trades).toBeGreaterThan(100);
    expect(a.conversion).toBeGreaterThan(0.8);
    expect(a.conversion).toBeLessThan(0.97);
    expect(a.bandCancellationRate).toBeLessThan(0.05);
    expect(a.settlement.p50Ms).toBeGreaterThan(1_500);
    expect(a.settlement.p95Ms).toBeLessThan(10_000);
    expect(a.custodyEnd).toBeGreaterThan(0n);
  });

  it("only writes to a sim- partner", () => {
    expect(() => simulateHistory(options({ partner: "demo-bank" }))).toThrow(/sim-/);
  });
});

describe("simulateHistory: sign-ups", () => {
  it("spreads sign-ups over the period, whatever the time of day", () => {
    // Just after midnight in Pakistan, and late in the evening: the same spread.
    for (const now of ["2026-11-22T19:20:00Z", "2026-11-22T17:50:00Z"]) {
      const history = simulateHistory(options({ savers: 400, now: new Date(now) }));
      const joined = history.wallets.map((w) => Date.parse(w.createdAt));
      const lastDay = Date.parse(now) - 86_400_000;
      // Rising towards today, but no pile-up on the last day (about 1% expected).
      expect(history.wallets.length).toBeGreaterThan(390);
      expect(joined.filter((at) => at > lastDay).length).toBeLessThan(400 * 0.05);
    }
  });
});

describe("store: simulated and real records never mix", () => {
  it("refuses simulated records for a partner with real ones, and clears only simulated ones", () => {
    const store = new Store(null);
    store.open("unit");
    const history = simulateHistory(options({ savers: 10 }));
    store.addSimulated(history);
    expect(store.walletsOf("sim-bank")).toHaveLength(history.wallets.length);

    const real = { ...history.wallets[0]!, id: "wal_real", simulated: undefined };
    store.saveWallet(real);
    expect(() => store.addSimulated(simulateHistory(options({ savers: 5, seed: 2 })))).toThrow(
      /real records/,
    );
    const removed = store.clearSimulated("sim-bank");
    expect(removed).toBe(
      history.wallets.length + history.quotes.length + history.transactions.length,
    );
    expect(store.walletsOf("sim-bank").map((w) => w.id)).toEqual(["wal_real"]);
  });

  it("refuses an id or address already in use, and then changes nothing", () => {
    const store = new Store(null);
    store.open("unit");
    const real = simulateHistory(options({ savers: 3, seed: 7 }));
    const realWallet = { ...real.wallets[0]!, partnerSlug: "demo-bank", simulated: undefined };
    store.saveWallet(realWallet);

    const sameId = simulateHistory(options({ savers: 3 }));
    sameId.wallets[1] = { ...sameId.wallets[1]!, id: realWallet.id };
    expect(() => store.addSimulated(sameId)).toThrow(/wallet id .* already in use/);

    const sameAddress = simulateHistory(options({ savers: 3 }));
    sameAddress.wallets[1] = {
      ...sameAddress.wallets[1]!,
      address: realWallet.address.toUpperCase() as `0x${string}`,
    };
    expect(() => store.addSimulated(sameAddress)).toThrow(/address .* already in use/);

    const twice = simulateHistory(options({ savers: 20 }));
    const first = twice.transactions[0]!;
    twice.transactions.push({ ...first });
    expect(() => store.addSimulated(twice)).toThrow(/transaction id .* already in use/);

    expect(store.walletsOf("sim-bank")).toHaveLength(0);
    expect(store.walletsOf("demo-bank")).toEqual([realWallet]);
  });

  it("refuses a record that is not marked simulated", () => {
    const store = new Store(null);
    store.open("unit");
    const history = simulateHistory(options({ savers: 3 }));
    history.wallets[0] = { ...history.wallets[0]!, simulated: undefined };
    expect(() => store.addSimulated(history)).toThrow(/not marked simulated/);
  });
});
