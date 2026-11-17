import "server-only";
import { readData, writeData } from "./datafile";
import { partner } from "./partner";

/** What the partner recorded when it opened the account (lib/onboarding.ts). */
export interface OnboardingRecord {
  openedAt: string;
  cnicMasked: string;
  phoneMasked: string;
  aml: "clear";
  riskBand: "low" | "medium" | "high";
  /** High risk: referred for enhanced due diligence, Gold Savings not opened. */
  outcome: "opened" | "referred";
}

/** Keyed fingerprints (lib/secrets.ts) of the CNIC and mobile number: never the numbers. */
export interface IdentityPrints {
  cnic: string;
  phone: string;
}

export interface Customer {
  id: string;
  name: string;
  firstName: string;
  description: string;
  kycLevel: "asaan" | "standard";
  onboarding?: OnboardingRecord;
  identity?: IdentityPrints;
}

/** The personas from FYP-1 §2.4, each at the partner that suits them. */
const PERSONAS: Record<"bank" | "wallet", Customer[]> = {
  bank: [
    {
      id: "hassan",
      name: "Hassan Raza",
      firstName: "Hassan",
      description: "IT manager in Lahore, saves PKR 25,000 a month",
      kycLevel: "standard",
    },
    {
      id: "bushra",
      name: "Bushra Khan",
      firstName: "Bushra",
      description: "Freelance designer in Karachi, paid in dollars",
      kycLevel: "standard",
    },
  ],
  wallet: [
    {
      id: "aliya",
      name: "Aliya Siddiqui",
      firstName: "Aliya",
      description: "Student at LUMS, saves PKR 1,000 at a time",
      kycLevel: "asaan",
    },
    {
      id: "kamran",
      name: "Kamran Ali",
      firstName: "Kamran",
      description: "Delivery rider in Rawalpindi, saves what is left each week",
      kycLevel: "asaan",
    },
  ],
};

// Customers who signed up in the demo (lib/datafile.ts). Only masked numbers and keyed
// fingerprints are stored: the CNIC and the mobile number themselves are never kept.
const cache = globalThis as typeof globalThis & { __signups?: Map<string, Customer[]> };
const signupsBySlug = (cache.__signups ??= new Map());

function signups(): Customer[] {
  const slug = partner().slug;
  let list = signupsBySlug.get(slug);
  if (!list) {
    list = readData<Customer[]>("customers", []);
    signupsBySlug.set(slug, list);
  }
  return list;
}

export function allCustomers(): Customer[] {
  return [...PERSONAS[partner().kind], ...signups()];
}

export function findCustomer(id: string | undefined): Customer | undefined {
  return id ? allCustomers().find((c) => c.id === id) : undefined;
}

/**
 * The customer who already opened an account with this CNIC, or this mobile number, at this
 * partner. Applications referred for review count too: a second application cannot get round
 * the review.
 */
export function customerWithIdentity(prints: IdentityPrints): {
  byCnic?: Customer;
  byPhone?: Customer;
} {
  const list = signups();
  return {
    byCnic: list.find((c) => c.identity?.cnic === prints.cnic),
    byPhone: list.find((c) => c.identity?.phone === prints.phone),
  };
}

/** Call with no await between the identity check and this, so two sign-ups cannot race. */
export function addCustomer(customer: Customer): void {
  const list = signups();
  list.push(customer);
  writeData("customers", list);
}
