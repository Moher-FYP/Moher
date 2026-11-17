/**
 * Display formatting only. Amounts arrive from MOHAR as exact decimal strings; these helpers
 * never feed back into any calculation.
 */

const pkrFormat = new Intl.NumberFormat("en-PK", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function pkr(amount: string): string {
  return `Rs ${pkrFormat.format(Number(amount))}`;
}

/** "0.60216701" -> "0.6022 g" (4 places is what a customer reads; the exact value is in title). */
export function grams(amount: string, places = 4): string {
  return `${Number(amount).toFixed(places)} g`;
}

export function shortHash(hash: string): string {
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

const timeFormat = new Intl.DateTimeFormat("en-PK", {
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});

export function when(iso: string): string {
  return timeFormat.format(new Date(iso));
}

export function errorMessage(error: unknown): string {
  const limit = limitMessage(error);
  if (limit) return limit;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return "Something went wrong. Try again.";
}

const receiptFormat = new Intl.DateTimeFormat("en-PK", {
  timeZone: "Asia/Karachi",
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
});

/** Full date and time in Pakistan time, for receipts. */
export function fullDate(iso: string): string {
  return `${receiptFormat.format(new Date(iso))} PKT`;
}

/** The exact amount MOHAR returned (8 decimals), for receipts. */
export function exactGrams(amount: string): string {
  return `${amount} g`;
}

const usdFormat = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function usd(amount: string): string {
  return `US$ ${usdFormat.format(Number(amount))}`;
}

/** MOHAR's limit_exceeded error, in words a customer understands. */
function limitMessage(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const { code, details } = error as { code?: unknown; details?: Record<string, unknown> };
  if (code !== "limit_exceeded" || !details) return undefined;
  const perTrade = pkr(String(details.perTradePkr));
  const perDay = pkr(String(details.per24HoursPkr));
  // The most one purchase can be now: the per-trade limit, or less if the day is nearly used.
  const most = Math.min(Number(details.perTradePkr), Number(details.remaining24HoursPkr));
  return `That is over your account's limit: ${perTrade} per purchase and ${perDay} in any 24 hours. The most you can buy now is ${pkr(String(most))}.`;
}
