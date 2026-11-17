import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { MoharApiError } from "@mohar/sdk";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { findCustomer, type Customer } from "./customers";
import { getMohar } from "./mohar";
import { partner } from "./partner";

/** One cookie per partner: both apps run on localhost, and cookies ignore the port. */
export function sessionCookie(): string {
  return `${partner().slug}_session`;
}

/**
 * The cookie holds the customer id and an HMAC of it, so a customer cannot change the id to
 * sign in as someone else. SESSION_SECRET signs it; the fallback is for local demos only.
 */
function sessionSecret(): string {
  return process.env.SESSION_SECRET ?? `local-demo-only-${partner().slug}`;
}

function sign(customerId: string): string {
  return createHmac("sha256", sessionSecret()).update(customerId).digest("base64url");
}

export function sessionValue(customerId: string): string {
  return `${customerId}.${sign(customerId)}`;
}

/** The customer a cookie value names, if its signature is right. */
export function customerFromSession(value: string | undefined): Customer | undefined {
  const dot = value?.lastIndexOf(".") ?? -1;
  if (!value || dot <= 0) return undefined;
  const id = value.slice(0, dot);
  const given = Buffer.from(value.slice(dot + 1));
  const expected = Buffer.from(sign(id));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return undefined;
  return findCustomer(id);
}

/** The signed-in customer, or undefined. Pages that trade use requireCustomer instead. */
export async function currentCustomer(): Promise<Customer | undefined> {
  return customerFromSession((await cookies()).get(sessionCookie())?.value);
}

/**
 * The signed-in customer whose Gold Savings is open, or a redirect: to the login screen, or
 * to the welcome screen for an application that was referred for review.
 */
export async function requireCustomer(): Promise<Customer> {
  const customer = await currentCustomer();
  if (!customer) redirect("/login");
  if (customer.onboarding?.outcome === "referred") redirect("/welcome");
  return customer;
}

// Bank-side mapping customer -> MOHAR wallet id. A real bank keeps this in its core banking
// system; the demo keeps it in memory and asks MOHAR again after a restart (registering the
// same customer twice returns the wallet MOHAR already has).
const globalWallets = globalThis as typeof globalThis & { __demoWallets?: Map<string, string> };
const walletIds: Map<string, string> = (globalWallets.__demoWallets ??= new Map());

async function registerWallet(customer: Customer): Promise<string> {
  const p = partner();
  const wallet = await getMohar().registerWallet({
    externalCustomerId: `${p.slug}-${customer.id}`,
    kyc: {
      // The partner's own KYC record id, never the CNIC. MOHAR stores only a keyed hash of it.
      reference: `${p.kycPrefix}-${customer.id.toUpperCase()}`,
      level: customer.kycLevel,
      verifiedAt: customer.onboarding?.openedAt ?? "2026-09-01T09:00:00.000Z",
    },
  });
  walletIds.set(customer.id, wallet.id);
  return wallet.id;
}

export async function walletIdFor(customer: Customer): Promise<string> {
  return walletIds.get(customer.id) ?? registerWallet(customer);
}

/** Runs `fn` with the customer's wallet id, re-registering once if MOHAR no longer knows it. */
export async function withWallet<T>(
  customer: Customer,
  fn: (walletId: string) => Promise<T>,
): Promise<T> {
  try {
    return await fn(await walletIdFor(customer));
  } catch (error) {
    if (
      error instanceof MoharApiError &&
      error.code === "not_found" &&
      walletIds.has(customer.id)
    ) {
      walletIds.delete(customer.id);
      return fn(await registerWallet(customer));
    }
    throw error;
  }
}

/** Which demo customer a MOHAR wallet belongs to, if the bank has opened it this session. */
export function customerForWallet(walletId: string | undefined): Customer | undefined {
  for (const [customerId, id] of walletIds) {
    if (id === walletId) return findCustomer(customerId);
  }
  return undefined;
}

/** True if the transaction is the customer's own, or gold sent to them. */
export async function canView(
  customer: Customer,
  txn: { type: string; walletId: string; counterpartyWalletId?: string },
): Promise<boolean> {
  const walletId = await walletIdFor(customer);
  return (
    txn.walletId === walletId || (txn.type === "transfer" && txn.counterpartyWalletId === walletId)
  );
}
