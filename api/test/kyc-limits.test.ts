import { describe, expect, it } from "vitest";
import { overLimit, parseKycLimits } from "../src/domain/kyc-limits.js";
import type { TransactionRecord } from "../src/domain/types.js";
import { Store } from "../src/store/store.js";

const DEFAULTS = "asaan=50000:100000,standard=500000:1000000,enhanced=2500000:5000000";
const PKR = (rupees: number) => BigInt(rupees) * 100n;

describe("KYC limits", () => {
  it("reads per-trade and 24-hour limits for every level, in paisa", () => {
    const limits = parseKycLimits(DEFAULTS);
    expect(limits.asaan).toEqual({ perTradePaisa: PKR(50_000), per24HoursPaisa: PKR(100_000) });
    expect(limits.enhanced.per24HoursPaisa).toBe(PKR(5_000_000));
  });

  it("refuses a setting that is incomplete, unknown, repeated or upside down", () => {
    expect(() => parseKycLimits("asaan=50000:100000")).toThrow(/no limit for standard, enhanced/);
    expect(() => parseKycLimits(`${DEFAULTS},gold=1:2`)).toThrow(/unknown level "gold"/);
    expect(() => parseKycLimits(`${DEFAULTS},asaan=1:2`)).toThrow(/"asaan" is given twice/);
    expect(() =>
      parseKycLimits("asaan=50000:10000,standard=500000:1000000,enhanced=2500000:5000000"),
    ).toThrow(/at least the per-trade limit/);
    expect(() => parseKycLimits("asaan=50,000:100000")).toThrow(/is not level=/);
  });

  it("checks one purchase, then the running 24-hour total", () => {
    const { asaan } = parseKycLimits(DEFAULTS);
    expect(overLimit(asaan, PKR(50_000), 0n)).toBeUndefined(); // exactly at the limit
    expect(overLimit(asaan, PKR(50_001), 0n)).toBe("per_trade");
    expect(overLimit(asaan, PKR(20_000), PKR(80_000))).toBeUndefined(); // reaches 100,000
    expect(overLimit(asaan, PKR(20_000), PKR(80_001))).toBe("per_24_hours");
  });

  it("counts a wallet's purchases that did not fail, inside the window only", () => {
    const store = new Store(null);
    store.open("unit");
    const mint = (id: string, patch: Partial<TransactionRecord>): TransactionRecord => ({
      id,
      partnerSlug: "demo-bank",
      type: "mint",
      status: "confirmed",
      walletId: "wal_1",
      grams: "1",
      netPaisa: String(PKR(10_000)),
      createdAt: "2026-11-17T10:00:00.000Z",
      ...patch,
    });
    store.saveTransaction(mint("txn_1", {}));
    store.saveTransaction(mint("txn_2", { status: "pending" }));
    store.saveTransaction(mint("txn_3", { status: "failed" })); // never happened
    store.saveTransaction(mint("txn_4", { createdAt: "2026-11-16T09:00:00.000Z" })); // too old
    store.saveTransaction(mint("txn_5", { walletId: "wal_2" })); // someone else
    store.saveTransaction(mint("txn_6", { type: "burn" })); // a sale, not a purchase

    expect(store.boughtSince("wal_1", "2026-11-16T10:00:00.000Z")).toBe(PKR(20_000));
  });
});
