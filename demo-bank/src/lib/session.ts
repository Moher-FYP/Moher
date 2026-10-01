import "server-only";
import { MoharApiError } from "@mohar/sdk";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { findCustomer, type Customer } from "./customers";
import { getMohar } from "./mohar";

export const SESSION_COOKIE = "demo_bank_customer";

/** The signed-in demo customer, or a redirect to the login screen. */
export async function requireCustomer(): Promise<Customer> {
  const customer = findCustomer((await cookies()).get(SESSION_COOKIE)?.value);
  if (!customer) redirect("/login");
  return customer;
}

// Bank-side mapping customer -> MOHAR wallet id. A real bank keeps this in its core banking
// system; the demo keeps it in memory and re-registers if MOHAR forgot the wallet (e.g. after
// the local chain was restarted).
const globalWallets = globalThis as typeof globalThis & { __demoWallets?: Map<string, string> };
const walletIds: Map<string, string> = (globalWallets.__demoWallets ??= new Map());

async function registerWallet(customer: Customer): Promise<string> {
  const wallet = await getMohar().registerWallet({
    externalCustomerId: `demo-bank-${customer.id}`,
    kyc: {
      // The bank's own KYC record id. MOHAR stores only its hash.
      reference: `DEMOBANK-KYC-${customer.id.toUpperCase()}`,
      level: "standard",
      verifiedAt: "2026-09-01T09:00:00.000Z",
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
