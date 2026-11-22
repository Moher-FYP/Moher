"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { randomBytes } from "node:crypto";
import { MoharApiError } from "@mohar/sdk";
import { addCustomer, customerWithIdentity, findCustomer, type Customer } from "@/lib/customers";
import { errorMessage, pkr } from "@/lib/format";
import { getMohar, moharApiUrl, moharDevKey } from "@/lib/mohar";
import { loggingFetch } from "@/lib/devlog";
import { recallQuote, rememberQuote } from "@/lib/quotes";
import { maskCnic, maskPhone, readApplication, riskBand, screen } from "@/lib/onboarding";
import { partner } from "@/lib/partner";
import { fingerprint } from "@/lib/secrets";
import { raastLabel, rememberPayment, type Payment } from "@/lib/payments";
import {
  requireCustomer,
  sessionCookie,
  sessionValue,
  walletIdFor,
  withWallet,
} from "@/lib/session";

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

async function startSession(customer: Customer): Promise<void> {
  (await cookies()).set(sessionCookie(), sessionValue(customer.id), {
    httpOnly: true,
    sameSite: "lax",
    // Sent over HTTPS only once hosted; plain http://localhost keeps working in development.
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
}

export async function signIn(formData: FormData): Promise<void> {
  const customer = findCustomer(String(formData.get("customer")));
  if (!customer) back("/login", new Error("Choose a customer to continue."));
  await startSession(customer);
  if (customer.onboarding?.outcome === "referred") redirect("/welcome");
  await walletIdFor(customer).catch(() => undefined); // open Gold Savings on first sign-in
  redirect("/");
}

export async function signOut(): Promise<void> {
  (await cookies()).delete(sessionCookie());
  redirect("/login");
}

/**
 * Opens a new customer's account: checks the form, screens the name, scores the risk, and
 * for low and medium risk opens Gold Savings with MOHAR. All of it simulated (lib/onboarding).
 */
export async function openAccount(formData: FormData): Promise<void> {
  const read = readApplication(formData, new Date());
  if (!read.ok) back("/signup", new Error(read.problem));
  const { application } = read;

  if (screen(application) === "match") {
    // A real partner files a report and tells the customer nothing more specific.
    back("/signup", new Error("We cannot open this account online. Please visit a branch."));
  }

  // One account per CNIC at each partner (State Bank, Asaan Account rules), and a mobile
  // number in the customer's own name: a number already paired with another CNIC is refused.
  // A real partner confirms the pairing with the mobile operator; the demo checks its own
  // customers. Nothing is awaited from here until addCustomer, so two sign-ups cannot race.
  const identity = {
    cnic: fingerprint("cnic", application.cnic),
    phone: fingerprint("phone", application.phone),
  };
  const existing = customerWithIdentity(identity);
  if (existing.byCnic) {
    back(
      "/signup",
      new Error(
        existing.byCnic.onboarding?.outcome === "referred"
          ? "An application with this CNIC is already being reviewed. We will contact you."
          : "An account is already open with this CNIC. Sign in instead.",
      ),
    );
  }
  if (existing.byPhone) {
    back(
      "/signup",
      new Error(
        "This mobile number is registered to another customer. Use a number in your own name.",
      ),
    );
  }

  const risk = riskBand(application);
  const firstName = application.fullName.split(" ")[0] ?? application.fullName;
  const customer: Customer = {
    id: `c${randomBytes(4).toString("hex")}`,
    name: application.fullName,
    firstName,
    description: `Opened online on ${new Date().toLocaleDateString("en-PK", { day: "numeric", month: "short" })}`,
    kycLevel: partner().newCustomerKyc,
    onboarding: {
      openedAt: new Date().toISOString(),
      cnicMasked: maskCnic(application.cnic),
      phoneMasked: maskPhone(application.phone),
      aml: "clear",
      riskBand: risk.band,
      outcome: risk.band === "high" ? "referred" : "opened",
    },
    identity,
  };
  addCustomer(customer);
  await startSession(customer);

  if (customer.onboarding?.outcome === "opened") {
    try {
      await walletIdFor(customer); // MOHAR registers the wallet on-chain
    } catch (error) {
      back("/welcome", error);
    }
  }
  redirect("/welcome");
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
  // "Sell all" sends the exact balance; otherwise grams, or rupees to receive (the pad's switch).
  const all = lastValue(formData, "sellAll");
  const gramsAmount = all || lastValue(formData, "grams");
  const pkrAmount = all ? "" : lastValue(formData, "amountPkr");
  let request: { grams: string } | { amountPkr: string };
  if (gramsAmount) {
    if (!GRAMS.test(gramsAmount) || Number(gramsAmount) <= 0) {
      back("/sell", new Error("Enter how many grams to sell, for example 0.25."));
    }
    request = { grams: gramsAmount };
  } else {
    if (!PKR.test(pkrAmount) || Number(pkrAmount) < 100) {
      back("/sell", new Error("Enter at least Rs 100 to sell, or switch to grams."));
    }
    request = { amountPkr: pkrAmount };
  }
  let quoteId: string;
  try {
    const quote = await withWallet(customer, (walletId) =>
      getMohar().createQuote({ walletId, side: "sell", ...request }),
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

  // Where the money comes from (buy) or goes to (sell): the partner's own account, or Raast.
  let payment: Payment = { method: "own", label: partner().ownFunds };
  if (formData.get("payWith") === "raast") {
    const label = raastLabel(String(formData.get("raastId") ?? ""));
    if (!label) {
      back(
        `/quote/${quoteId}`,
        new Error("Enter a Raast ID: a mobile number (0300 1234567) or an IBAN (PK…)."),
      );
    }
    payment = { method: "raast", label };
  }

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
  rememberPayment(transactionId, payment);
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
    // The limit is the receiver's, so say so rather than show the sender their own limits.
    if (error instanceof MoharApiError && error.code === "limit_exceeded") {
      const most = Number(error.details?.largestAllowedPkr ?? 0);
      back(
        "/send",
        new Error(
          `That is more than ${recipient?.firstName}'s account can receive right now under its KYC limits` +
            (most > 0 ? ` (up to ${pkr(String(most))} of gold).` : ". Try again another day."),
        ),
      );
    }
    back("/send", error);
  }
  redirect(`/tx/${transactionId}`);
}

// ------------------------------------------------------------------ demo controls

/**
 * Moves the mock gold price (demo only) to show what happens when the market moves. Returns a
 * message when MOHAR refuses, e.g. because the price would leave the allowed band.
 */
export async function moveGoldPrice(formData: FormData): Promise<string | undefined> {
  const direction = String(formData.get("direction"));
  // "reset" lets MOHAR decide what normal is: the market price when it mirrors a real feed,
  // otherwise the price the mock feed started with.
  let path = "/dev/price/reset";
  let body: Record<string, string> = {};
  if (direction !== "reset") {
    const now = Number((await getMohar().getPrice()).xauUsd);
    path = "/dev/price";
    body = { xauUsd: (direction === "up" ? now * 1.01 : now * 0.99).toFixed(2) };
  }
  const response = await loggingFetch(`${moharApiUrl()}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${moharDevKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (response.ok) return undefined;
  const failure = (await response.json().catch(() => null)) as { error?: { message?: string } };
  if (response.status === 404) return "Price controls are switched off on this MOHAR server.";
  if (response.status === 401) return "This demo's operator key (MOHAR_DEV_KEY) was refused.";
  return failure?.error?.message ?? "The price could not be changed.";
}
