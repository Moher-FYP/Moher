import { describe, expect, it } from "vitest";
import {
  MoneyFormatError,
  formatGrams,
  formatPkr,
  parseDecimal,
  parseGrams,
  parsePkr,
} from "../src/domain/money.js";
import {
  QuoteTooSmallError,
  computeQuote,
  pricePerGramPaisa,
  valuePaisa,
} from "../src/domain/pricing.js";

// FYP-1 figures: USD 4,616/oz spot, PKR 279.05/USD
const price = { xauUsdE8: 4_616n * 10n ** 8n, usdPkrE4: 2_790_500n };
const fees = { platformFeeBps: 50n, fxMarginBps: 25n };

describe("money", () => {
  it("parses and formats grams and PKR exactly", () => {
    expect(parseGrams("0.6041")).toBe(60_410_000n);
    expect(formatGrams(60_410_000n)).toBe("0.60410000");
    expect(parsePkr("25000")).toBe(2_500_000n);
    expect(formatPkr(2_500_050n)).toBe("25000.50");
    expect(formatPkr(-5n)).toBe("-0.05");
    expect(parseDecimal("007.10", 2)).toBe(710n);
  });

  it("rejects bad input", () => {
    for (const bad of ["", "-1", "1e5", "1.2.3", "abc", " "]) {
      expect(() => parsePkr(bad)).toThrow(MoneyFormatError);
    }
    expect(() => parsePkr("1.234")).toThrow(/decimal places/);
    expect(() => parseGrams("0.000000001")).toThrow(/decimal places/);
  });
});

describe("pricing", () => {
  it("prices a gram at PKR 41,413.17 (cross-checked with Python decimal)", () => {
    const perGram = pricePerGramPaisa(price);
    expect(formatPkr(perGram)).toBe("41413.17");
  });

  it("buy by PKR: customer pays exactly the amount; FX margin comes out of it", () => {
    const q = computeQuote("buy", { amountPaisa: parsePkr("25000") }, price, fees);
    expect(formatPkr(q.netPaisa)).toBe("25000.00");
    expect(q.netPaisa).toBe(q.grossPaisa + q.fxMarginPaisa);
    expect(formatGrams(q.grams)).toBe("0.60216701");
    // never more gold than the gross amount buys
    expect(valuePaisa(q.grams, price)).toBeLessThanOrEqual(q.grossPaisa);
    expect(formatPkr(q.platformFeePaisa)).toBe(formatPkr((q.grossPaisa * 50n) / 10_000n));
  });

  it("buy by grams: customer is charged gross + margin, rounded up", () => {
    const q = computeQuote("buy", { grams: parseGrams("1") }, price, fees);
    expect(formatPkr(q.grossPaisa)).toBe("41413.18");
    expect(formatPkr(q.netPaisa)).toBe("41516.72");
  });

  it("sell by grams: customer receives gross − margin", () => {
    const q = computeQuote("sell", { grams: parseGrams("0.5") }, price, fees);
    expect(formatPkr(q.grossPaisa)).toBe("20706.58");
    expect(q.netPaisa).toBe(q.grossPaisa - q.fxMarginPaisa);
    expect(q.netPaisa).toBeLessThan(q.grossPaisa);
  });

  it("sell by PKR: sells enough gold for the customer to receive at least the amount", () => {
    const q = computeQuote("sell", { amountPaisa: parsePkr("20000") }, price, fees);
    expect(q.netPaisa).toBe(parsePkr("20000"));
    const receivable = valuePaisa(q.grams, price);
    expect(receivable).toBeGreaterThanOrEqual(q.grossPaisa);
  });

  it("rejects amounts too small to trade", () => {
    expect(() => computeQuote("buy", { amountPaisa: 0n }, price, fees)).toThrow(QuoteTooSmallError);
    expect(() => computeQuote("sell", { grams: 1n }, price, fees)).toThrow(QuoteTooSmallError);
  });
});
