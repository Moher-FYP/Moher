/**
 * The partner's side of opening a Gold Savings account, simulated for the demo.
 *
 * In a real bank or wallet these steps are the partner's own systems: NADRA verification of
 * the CNIC, a screening service for sanctions and politically exposed persons, and its risk
 * model. MOHAR never sees any of it. It receives only the KYC level and a reference to the
 * partner's KYC record, and writes a keyed fingerprint of that reference on-chain.
 *
 * Nothing here reads the CNIC image: the "reader" takes the details the customer typed, and
 * the screen says so. What follows the State Bank's rules for a real partner (see
 * docs/kyc-limits.md): one account per CNIC at each partner, a mobile number in the
 * customer's own name, no account on an expired CNIC, and customers aged 18 and over.
 * What is only simulated: NADRA Verisys of the details, the SIM ownership check with the
 * mobile operator, liveness of the photo, and the screening lists. The rules are simple and fixed so that a demo behaves the same every time.
 */

export interface Application {
  fullName: string;
  cnic: string;
  /** YYYY-MM-DD, or "lifetime" for a card issued for life. */
  cnicExpiry: string;
  dateOfBirth: string;
  phone: string;
  occupation: Occupation;
  sourceOfFunds: SourceOfFunds;
  monthlyAmount: MonthlyAmount;
  politicallyExposed: boolean;
}

export const OCCUPATIONS = {
  salaried: "Salaried employee",
  business: "Business owner",
  freelancer: "Freelancer",
  student: "Student",
  homemaker: "Homemaker",
  other: "Other",
} as const;
export type Occupation = keyof typeof OCCUPATIONS;

export const SOURCES_OF_FUNDS = {
  salary: "Salary",
  business: "Business income",
  remittance: "Money from family abroad",
  savings: "Savings",
  other: "Other",
} as const;
export type SourceOfFunds = keyof typeof SOURCES_OF_FUNDS;

export const MONTHLY_AMOUNTS = {
  up_to_25k: "Up to Rs 25,000",
  "25k_100k": "Rs 25,000 to Rs 100,000",
  "100k_500k": "Rs 100,000 to Rs 500,000",
  over_500k: "More than Rs 500,000",
} as const;
export type MonthlyAmount = keyof typeof MONTHLY_AMOUNTS;

/**
 * Names that the simulated screening service reports as a match. Invented, so that the demo
 * can show a refusal: "Test Blocked Person" is refused and "Test Exposed Person" is high risk.
 */
const WATCHLIST = ["test blocked person"];
const PEP_LIST = ["test exposed person"];

/** Reads and checks the form. Returns the application, or the first problem in plain words. */
export function readApplication(
  form: FormData,
  today: Date,
): { ok: true; application: Application } | { ok: false; problem: string } {
  const text = (name: string) => String(form.get(name) ?? "").trim();
  const fullName = text("fullName").replace(/\s+/g, " ");
  const cnic = text("cnic").replace(/[\s-]/g, "");
  const phone = text("phone").replace(/[\s-]/g, "");
  const dateOfBirth = text("dateOfBirth");
  const lifetime = form.get("cnicLifetime") === "yes";
  const cnicExpiry = lifetime ? "lifetime" : text("cnicExpiry");
  const occupation = text("occupation");
  const sourceOfFunds = text("sourceOfFunds");
  const monthlyAmount = text("monthlyAmount");

  if (!/^[A-Za-z][A-Za-z .'-]{2,59}$/.test(fullName) || !fullName.includes(" ")) {
    return { ok: false, problem: "Enter your full name as it appears on your CNIC." };
  }
  if (!/^\d{13}$/.test(cnic)) {
    return { ok: false, problem: "Enter the 13 digits of your CNIC, for example 35202-1234567-1." };
  }
  // The first digit is the province or region of issue, 1 to 7.
  if (!/^[1-7]/.test(cnic)) {
    return { ok: false, problem: "That is not a valid CNIC number. Check the first digit." };
  }
  // The State Bank blocks accounts on an expired CNIC, so an expired card cannot open one.
  if (cnicExpiry !== "lifetime") {
    const expires = new Date(`${cnicExpiry}T23:59:59Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cnicExpiry) || Number.isNaN(expires.getTime())) {
      return {
        ok: false,
        problem: "Enter your CNIC's expiry date, or tick that it is valid for life.",
      };
    }
    if (expires < today) {
      return {
        ok: false,
        problem: "Your CNIC has expired. Renew it with NADRA, then apply again.",
      };
    }
  }
  if (!/^03\d{9}$/.test(phone)) {
    return { ok: false, problem: "Enter a Pakistani mobile number, for example 0300 1234567." };
  }
  const born = new Date(`${dateOfBirth}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth) || Number.isNaN(born.getTime())) {
    return { ok: false, problem: "Enter your date of birth." };
  }
  if (ageOn(born, today) < 18) {
    return { ok: false, problem: "Gold Savings is for customers aged 18 and over." };
  }
  if (!(occupation in OCCUPATIONS)) return { ok: false, problem: "Choose your occupation." };
  if (!(sourceOfFunds in SOURCES_OF_FUNDS)) {
    return { ok: false, problem: "Choose where the money for gold comes from." };
  }
  if (!(monthlyAmount in MONTHLY_AMOUNTS)) {
    return { ok: false, problem: "Choose how much you expect to buy each month." };
  }
  const image = form.get("cnicFront");
  if (!(image instanceof File) || image.size === 0) {
    return { ok: false, problem: "Add a photo of the front of your CNIC." };
  }
  if (!image.type.startsWith("image/") || image.size > 5 * 1024 * 1024) {
    return { ok: false, problem: "The CNIC photo must be an image of 5 MB or less." };
  }
  if (form.get("consent") !== "yes") {
    return { ok: false, problem: "Agree to the terms to open Gold Savings." };
  }

  return {
    ok: true,
    application: {
      fullName,
      cnic,
      cnicExpiry,
      dateOfBirth,
      phone,
      occupation: occupation as Occupation,
      sourceOfFunds: sourceOfFunds as SourceOfFunds,
      monthlyAmount: monthlyAmount as MonthlyAmount,
      politicallyExposed: form.get("politicallyExposed") === "yes",
    },
  };
}

function ageOn(born: Date, today: Date): number {
  let age = today.getUTCFullYear() - born.getUTCFullYear();
  const beforeBirthday =
    today.getUTCMonth() < born.getUTCMonth() ||
    (today.getUTCMonth() === born.getUTCMonth() && today.getUTCDate() < born.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

/** Simulated sanctions screening: "match" refuses the account outright. */
export function screen(application: Application): "clear" | "match" {
  return WATCHLIST.includes(application.fullName.toLowerCase()) ? "match" : "clear";
}

/**
 * A simple, explainable risk score. Politically exposed persons and the largest expected
 * amounts are high risk, which in a real partner means enhanced due diligence by a person.
 */
export function riskBand(application: Application): {
  band: "low" | "medium" | "high";
  reasons: string[];
} {
  const reasons: string[] = [];
  const exposed =
    application.politicallyExposed || PEP_LIST.includes(application.fullName.toLowerCase());
  if (exposed) reasons.push("Politically exposed person");
  if (application.monthlyAmount === "over_500k") reasons.push("Expected over Rs 500,000 a month");
  if (reasons.length > 0) return { band: "high", reasons };

  if (application.monthlyAmount === "100k_500k")
    reasons.push("Expected Rs 100,000 or more a month");
  if (application.sourceOfFunds === "other") reasons.push("Source of funds not stated");
  if (application.occupation === "other") reasons.push("Occupation not stated");
  return { band: reasons.length > 0 ? "medium" : "low", reasons };
}

/** 35202-1234567-1 shown as 35202-*******-1. */
export function maskCnic(cnic: string): string {
  return `${cnic.slice(0, 5)}-*******-${cnic.slice(12)}`;
}

/** 03001234567 shown as 0300 ***4567. */
export function maskPhone(phone: string): string {
  return `${phone.slice(0, 4)} ***${phone.slice(7)}`;
}
