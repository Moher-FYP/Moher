/**
 * Money as bigint fixed-point. Never use JS numbers for amounts.
 *   grams: 8 decimals (1n = 0.00000001 g), same as the token
 *   PKR:   2 decimals (1n = 1 paisa)
 */

export const GRAM_DECIMALS = 8;
export const PKR_DECIMALS = 2;

export class MoneyFormatError extends Error {}

const DECIMAL = /^(\d+)(?:\.(\d+))?$/;

/** "0.6041" -> 60_410_000n (decimals = 8). Rejects negatives, exponents and extra precision. */
export function parseDecimal(value: string, decimals: number): bigint {
  const match = DECIMAL.exec(value.trim());
  if (!match) throw new MoneyFormatError(`"${value}" is not a decimal number`);
  const [, whole = "0", fraction = ""] = match;
  if (fraction.length > decimals) {
    throw new MoneyFormatError(`"${value}" has more than ${decimals} decimal places`);
  }
  return BigInt(whole + fraction.padEnd(decimals, "0"));
}

/** 60_410_000n -> "0.60410000" (decimals = 8). Always prints exactly `decimals` places. */
export function formatDecimal(value: bigint, decimals: number): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals);
  return `${negative ? "-" : ""}${whole}${decimals > 0 ? `.${fraction}` : ""}`;
}

export const parseGrams = (value: string): bigint => parseDecimal(value, GRAM_DECIMALS);
export const formatGrams = (value: bigint): string => formatDecimal(value, GRAM_DECIMALS);
export const parsePkr = (value: string): bigint => parseDecimal(value, PKR_DECIMALS);
export const formatPkr = (value: bigint): string => formatDecimal(value, PKR_DECIMALS);

/** Integer division rounding up (for amounts charged to the customer). Both operands > 0. */
export function divCeil(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}
