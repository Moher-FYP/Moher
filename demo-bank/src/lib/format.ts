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
