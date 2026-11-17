import { describe, expect, it } from "vitest";
import {
  DEFAULT_KYC_LIMITS,
  headroom,
  overLimit,
  parseKycLimits,
} from "../src/domain/kyc-limits.js";
import type { TransactionRecord } from "../src/domain/types.js";
import { Store } from "../src/store/store.js";

const PKR = (rupees: number) => BigInt(rupees) * 100n;
const none = { creditedLast24HoursPaisa: 0n, creditedLast30DaysPaisa: 0n, holdingPaisa: 0n };

describe("KYC limits", () => {
  it("reads the four limits for every level, in paisa", () => {
    const limits = parseKycLimits(DEFAULT_KYC_LIMITS);
    expect(limits.asaan).toEqual({
      perTradePaisa: PKR(25_000),
      per24HoursPaisa: PKR(25_000),
      per30DaysPaisa: PKR(50_000),
      maxHoldingPaisa: PKR(200_000),
    });
    expect(limits.standard.per30DaysPaisa).toBe(PKR(1_000_000));
    expect(limits.standard.maxHoldingPaisa).toBe(PKR(1_000_000));
  });

  it("refuses a setting that is incomplete, unknown, repeated, upside down or old-style", () => {
    const [asaan, standard, enhanced] = DEFAULT_KYC_LIMITS.split(",");
    expect(() => parseKycLimits(asaan!)).toThrow(/no limit for standard, enhanced/);
    expect(() => parseKycLimits(`${DEFAULT_KYC_LIMITS},gold=1:2:3:4`)).toThrow(/unknown level/);
    expect(() => parseKycLimits(`${DEFAULT_KYC_LIMITS},${asaan}`)).toThrow(/given twice/);
    expect(() => parseKycLimits(`asaan=25000:25000:20000:200000,${standard},${enhanced}`)).toThrow(
      /at least the one before it/,
    );
    expect(() => parseKycLimits(`asaan=50000:100000,${standard},${enhanced}`)).toThrow(
      /is not level=perTrade:per24Hours:per30Days:maxHolding/,
    );
  });

  it("checks one credit, then 24 hours, then 30 days, then the holding", () => {
    const { asaan } = parseKycLimits(DEFAULT_KYC_LIMITS);
    expect(overLimit(asaan, PKR(25_000), none)).toBeUndefined(); // exactly at the limit
    expect(overLimit(asaan, PKR(25_001), none)).toBe("per_trade");
    const day = {
      ...none,
      creditedLast24HoursPaisa: PKR(20_000),
      creditedLast30DaysPaisa: PKR(20_000),
    };
    expect(overLimit(asaan, PKR(5_000), day)).toBeUndefined();
    expect(overLimit(asaan, PKR(5_001), day)).toBe("per_24_hours");
    const month = { ...none, creditedLast30DaysPaisa: PKR(45_000) };
    expect(overLimit(asaan, PKR(5_001), month)).toBe("per_30_days");
    const rich = { ...none, holdingPaisa: PKR(190_000) };
    expect(overLimit(asaan, PKR(10_001), rich)).toBe("max_holding");
    expect(headroom(asaan, { ...month, holdingPaisa: PKR(190_000) })).toBe(PKR(5_000));
  });

  it("counts purchases and gold received that did not fail, inside the window only", () => {
    const store = new Store(null);
    store.open("unit");
    const txn = (id: string, patch: Partial<TransactionRecord>): TransactionRecord => ({
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
    store.saveTransaction(txn("txn_1", {}));
    store.saveTransaction(txn("txn_2", { status: "pending" }));
    store.saveTransaction(txn("txn_3", { status: "failed" })); // never happened
    store.saveTransaction(txn("txn_4", { createdAt: "2026-11-16T09:00:00.000Z" })); // too old
    store.saveTransaction(txn("txn_5", { walletId: "wal_2" })); // someone else
    store.saveTransaction(txn("txn_6", { type: "burn" })); // a sale, not a credit
    // Gold sent to wal_1 counts at its value when sent; gold wal_1 sends does not.
    const transfer = {
      type: "transfer" as const,
      netPaisa: undefined,
      valuePaisa: String(PKR(3_000)),
    };
    store.saveTransaction(
      txn("txn_7", { ...transfer, walletId: "wal_2", counterpartyWalletId: "wal_1" }),
    );
    store.saveTransaction(
      txn("txn_8", { ...transfer, walletId: "wal_1", counterpartyWalletId: "wal_2" }),
    );

    expect(store.creditedSince("wal_1", "2026-11-16T10:00:00.000Z")).toBe(PKR(23_000));
  });
});
