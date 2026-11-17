import "server-only";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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

export interface Customer {
  id: string;
  name: string;
  firstName: string;
  description: string;
  kycLevel: "asaan" | "standard";
  onboarding?: OnboardingRecord;
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

// Customers who signed up in the demo are kept in a small JSON file per partner, so they
// survive a restart. A real partner keeps them in its core banking system. Only masked
// identity numbers are stored: the CNIC itself is never kept.
const DATA_DIR = join(process.cwd(), ".data");
const dataFile = () => join(DATA_DIR, `customers-${partner().slug}.json`);

const cache = globalThis as typeof globalThis & { __signups?: Map<string, Customer[]> };
const signupsBySlug = (cache.__signups ??= new Map());

function signups(): Customer[] {
  const slug = partner().slug;
  let list = signupsBySlug.get(slug);
  if (!list) {
    try {
      list = JSON.parse(readFileSync(dataFile(), "utf8")) as Customer[];
    } catch {
      list = [];
    }
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

export function addCustomer(customer: Customer): void {
  const list = signups();
  list.push(customer);
  mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${dataFile()}.tmp`;
  writeFileSync(tmp, JSON.stringify(list, null, 2), { mode: 0o600 });
  renameSync(tmp, dataFile());
}
