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

const LIMIT_REASONS: Record<string, string> = {
  per_trade: "for one transaction",
  per_24_hours: "for any 24 hours",
  per_30_days: "for any 30 days",
  max_holding: "for the most gold your account may hold",
};

/** MOHAR's limit_exceeded error, in words a customer understands. */
function limitMessage(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const { code, details } = error as { code?: unknown; details?: Record<string, unknown> };
  if (code !== "limit_exceeded" || !details) return undefined;
  const reason = LIMIT_REASONS[String(details.limit)] ?? "";
  const caps = `${pkr(String(details.perTradePkr))} per transaction, ${pkr(String(details.per24HoursPkr))} a day, ${pkr(String(details.per30DaysPkr))} in 30 days, and gold worth up to ${pkr(String(details.maxHoldingPkr))}`;
  const most = Number(details.largestAllowedPkr);
  const now =
    most > 0
      ? `The most you can receive now is ${pkr(String(details.largestAllowedPkr))}.`
      : "You cannot receive more gold until some of the limit frees up.";
  return `That is over your account's limit ${reason}. Your limits are ${caps}. ${now}`;
}

const wholeFormat = new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 });

/** Whole rupees for headline figures: "Rs 442,799". Receipts keep the paisa (pkr). */
export function pkrWhole(amount: string | number): string {
  return `Rs ${wholeFormat.format(Math.round(Number(amount)))}`;
}

/** Grams as a figure without the unit: "12.4813". */
export function gramsFigure(amount: string, places = 4): string {
  return Number(amount).toFixed(places);
}

/** One tola, the weight Pakistani families count gold in. */
export const GRAMS_PER_TOLA = 11.6638;

export function tola(amount: string): string {
  const t = Number(amount) / GRAMS_PER_TOLA;
  return t >= 0.1 ? t.toFixed(2) : t.toFixed(3);
}

/** "Hassan Raza" -> "HR". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (
    (parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "")
  ).toUpperCase();
}
