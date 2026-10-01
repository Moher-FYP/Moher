"use server";

import { MoharApiError } from "@mohar/sdk";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { findCustomer, type Customer } from "@/lib/customers";
import { errorMessage } from "@/lib/format";
import { getMohar, moharApiKey, moharApiUrl } from "@/lib/mohar";
import { loggingFetch } from "@/lib/devlog";
import { recallQuote, rememberQuote } from "@/lib/quotes";
import { SESSION_COOKIE, requireCustomer, walletIdFor, withWallet } from "@/lib/session";

const PKR = /^\d+(\.\d{1,2})?$/;
const GRAMS = /^\d+(\.\d{1,8})?$/;

/** Last non-empty value: a preset button's value wins over an empty text field. */
function lastValue(formData: FormData, name: string): string {
  const values = formData
    .getAll(name)
    .map((v) => String(v).replaceAll(",", "").trim())
    .filter(Boolean);
  return values.at(-1) ?? "";
}

function back(path: string, error: unknown): never {
  redirect(`${path}?error=${encodeURIComponent(errorMessage(error))}`);
}

// ------------------------------------------------------------------ session

export async function signIn(formData: FormData): Promise<void> {
  const customer = findCustomer(String(formData.get("customer")));
  if (!customer) back("/login", new Error("Choose a customer to continue."));
  (await cookies()).set(SESSION_COOKIE, customer.id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
  await walletIdFor(customer).catch(() => undefined); // open Gold Savings on first sign-in
  redirect("/");
}

export async function signOut(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}

// ------------------------------------------------------------------ trading

export async function quoteBuy(formData: FormData): Promise<void> {
  const customer = await requireCustomer();
  const amount = lastValue(formData, "amountPkr");
  if (!PKR.test(amount) || Number(amount) < 100) {
    back("/buy", new Error("Enter an amount of at least Rs 100."));
  }
  let quoteId: string;
  try {
    const quote = await withWallet(customer, (walletId) =>
      getMohar().createQuote({ walletId, side: "buy", amountPkr: amount }),
    );
    rememberQuote(quote, customer.id);
    quoteId = quote.id;
  } catch (error) {
    back("/buy", error);
  }
  redirect(`/quote/${quoteId}`);
}

export async function quoteSell(formData: FormData): Promise<void> {
  const customer = await requireCustomer();
  const amount = lastValue(formData, "grams");
  if (!GRAMS.test(amount) || Number(amount) <= 0) {
    back("/sell", new Error("Enter how many grams to sell, for example 0.25."));
  }
  let quoteId: string;
  try {
    const quote = await withWallet(customer, (walletId) =>
      getMohar().createQuote({ walletId, side: "sell", grams: amount }),
    );
    rememberQuote(quote, customer.id);
    quoteId = quote.id;
  } catch (error) {
    back("/sell", error);
  }
  redirect(`/quote/${quoteId}`);
}

export async function confirmQuote(formData: FormData): Promise<void> {
  const customer = await requireCustomer();
  const quoteId = String(formData.get("quoteId"));
  const quote = recallQuote(quoteId, customer.id);
  if (!quote) back("/", new Error("That price has expired. Start again."));

  let transactionId: string;
  try {
    // The quote id doubles as the idempotency key: a double-click cannot buy twice.
    const options = { idempotencyKey: `confirm-${quote.id}` };
    const txn =
      quote.side === "buy"
        ? await getMohar().mint({ quoteId: quote.id }, options)
        : await getMohar().burn({ quoteId: quote.id }, options);
    transactionId = txn.id;
  } catch (error) {
    back(`/quote/${quoteId}`, error);
  }
  redirect(`/tx/${transactionId}`);
}

export async function sendGold(formData: FormData): Promise<void> {
  const customer = await requireCustomer();
  const recipient = findCustomer(String(formData.get("recipient")));
  const amount = String(formData.get("grams") ?? "").trim();
  if (!recipient || recipient.id === customer.id) {
    back("/send", new Error("Choose who to send gold to."));
  }
  if (!GRAMS.test(amount) || Number(amount) <= 0) {
    back("/send", new Error("Enter how many grams to send, for example 0.1."));
  }

  let transactionId: string;
  try {
    const toWalletId = await walletIdFor(recipient as Customer);
    const txn = await withWallet(customer, (fromWalletId) =>
      getMohar().transfer({ fromWalletId, toWalletId, grams: amount }),
    );
    transactionId = txn.id;
  } catch (error) {
    back("/send", error);
  }
  redirect(`/tx/${transactionId}`);
}

// ------------------------------------------------------------------ demo controls

/** Moves the mock gold price (local demo only) to show what happens when the market moves. */
export async function moveGoldPrice(formData: FormData): Promise<void> {
  const direction = String(formData.get("direction"));
  const current = await getMohar().getPrice();
  const now = Number(current.xauUsd);
  const next = direction === "reset" ? 4616 : direction === "up" ? now * 1.01 : now * 0.99;
  const response = await loggingFetch(`${moharApiUrl()}/dev/price`, {
    method: "POST",
    headers: { Authorization: `Bearer ${moharApiKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ xauUsd: next.toFixed(2) }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: { message?: string } };
    throw new MoharApiError(
      response.status,
      "unknown",
      body?.error?.message ?? "Price change failed",
    );
  }
}
