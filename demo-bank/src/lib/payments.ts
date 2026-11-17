import "server-only";
import { readData, writeData } from "./datafile";
import { partner } from "./partner";

/**
 * How the customer paid for a purchase, or where a sale's rupees went. MOHAR never moves
 * rupees: the partner does, either inside its own books or over Raast, the State Bank's
 * instant payment system. The demo records the choice for the receipt and moves no money.
 */
export interface Payment {
  method: "own" | "raast";
  /** What the receipt shows, with account details masked. */
  label: string;
}

// Saved with the partner's other records (lib/datafile.ts), so a receipt still shows how the
// customer paid after a restart. Only the masked label is kept, never the full Raast ID.
const store = globalThis as typeof globalThis & {
  __demoPayments?: Map<string, Record<string, Payment>>;
};
const bySlug = (store.__demoPayments ??= new Map());

function payments(): Record<string, Payment> {
  const slug = partner().slug;
  let record = bySlug.get(slug);
  if (!record) {
    record = readData<Record<string, Payment>>("payments", {});
    bySlug.set(slug, record);
  }
  return record;
}

export function rememberPayment(transactionId: string, payment: Payment): void {
  const record = payments();
  record[transactionId] = payment;
  writeData("payments", record);
}

export function paymentFor(transactionId: string): Payment | undefined {
  return payments()[transactionId];
}

/** What a receipt shows when no payment was recorded, e.g. a trade made before this record. */
export const PAYMENT_NOT_RECORDED = "Payment method not recorded";

/**
 * A Raast ID is a mobile number (03xxxxxxxxx) or an IBAN (PK + 22 characters). Returns the
 * masked label, or undefined if it is neither.
 */
export function raastLabel(raastId: string): string | undefined {
  const id = raastId.replace(/[\s-]/g, "").toUpperCase();
  if (/^03\d{9}$/.test(id)) return `Raast, account on ${id.slice(0, 4)} ***${id.slice(7)}`;
  if (/^PK\d{2}[A-Z]{4}\d{16}$/.test(id)) return `Raast, account ${id.slice(0, 8)}…${id.slice(-4)}`;
  return undefined;
}
