import "server-only";

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

const store = globalThis as typeof globalThis & { __demoPayments?: Map<string, Payment> };
const payments: Map<string, Payment> = (store.__demoPayments ??= new Map());

export function rememberPayment(transactionId: string, payment: Payment): void {
  payments.set(transactionId, payment);
}

export function paymentFor(transactionId: string): Payment | undefined {
  return payments.get(transactionId);
}

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
