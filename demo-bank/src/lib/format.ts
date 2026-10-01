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
