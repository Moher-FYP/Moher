import "server-only";

/**
 * Which demo partner this copy of the app plays. One codebase, two partners: the point MOHAR
 * makes is that any bank or wallet can offer the same gold product through the same API.
 *
 *   DEMO_PARTNER=bank    MOHAR Bank, a retail bank (the default)
 *   DEMO_PARTNER=wallet  MOHAR Wallet, a mobile wallet
 *
 * Both names are invented for the demo. Each partner has its own MOHAR API key, webhook
 * secret and customers; `slug` is the partner's name at MOHAR (PARTNER_API_KEYS).
 */
export interface Partner {
  kind: "bank" | "wallet";
  slug: string;
  name: string;
  /** The word after the MOHAR mark in the app's wordmark: "Bank" or "Wallet". */
  word: string;
  description: string;
  /** Tagline on the sign-in screen. */
  tagline: string;
  /** Smallest first purchase the sign-in screen offers, in rupees. */
  fromPkr: number;
  /** Quick amounts on the buy screen, in rupees. */
  presets: number[];
  /**
   * The only colours a partner changes (docs: the canvas's Components board): its primary
   * button, the text on it, and the tint of its hero panels. The gold card, type and every
   * other part stay the same at every partner.
   */
  colors: { primary: string; onPrimary: string; hero: string };
  /** The KYC level a new customer is opened at (MOHAR's limits depend on it). */
  newCustomerKyc: "asaan" | "standard";
  kycLabel: string;
  /** Where money comes from and goes to when the customer pays with the partner itself. */
  ownFunds: string;
  /** Prefix of the KYC reference the partner sends MOHAR (never the CNIC itself). */
  kycPrefix: string;
  /** Default local MOHAR API key (the API's local default PARTNER_API_KEYS). */
  localApiKey: string;
}

const PARTNERS: Record<Partner["kind"], Partner> = {
  bank: {
    kind: "bank",
    slug: "demo-bank",
    name: "MOHAR Bank",
    word: "Bank",
    description: "A retail bank offering gold savings to its account holders",
    tagline: "Gold savings inside your bank account",
    fromPkr: 1000,
    presets: [1000, 5000, 10000, 25000],
    colors: { primary: "#111110", onPrimary: "#ffffff", hero: "#efe4d1" },
    newCustomerKyc: "standard",
    kycLabel: "Full account (standard KYC)",
    ownFunds: "MOHAR Bank current account",
    // Kept from before the wallet partner existed: Hassan's and Bushra's wallets on Amoy were
    // registered with this reference, and MOHAR refuses the same customer with a new one.
    kycPrefix: "DEMOBANK-KYC",
    localApiKey: "mk_test_local",
  },
  wallet: {
    kind: "wallet",
    slug: "moher-wallet",
    name: "MOHAR Wallet",
    word: "Wallet",
    description: "A mobile wallet offering gold savings from Rs 100",
    tagline: "Gold savings inside your wallet",
    fromPkr: 100,
    presets: [100, 500, 1000, 2000],
    colors: { primary: "#ff6a13", onPrimary: "#1a0f05", hero: "#f6dcc7" },
    newCustomerKyc: "asaan",
    kycLabel: "Asaan account (basic KYC)",
    ownFunds: "MOHAR Wallet balance",
    kycPrefix: "MW-KYC",
    localApiKey: "mk_test_wallet",
  },
};

export function partner(): Partner {
  return PARTNERS[process.env.DEMO_PARTNER === "wallet" ? "wallet" : "bank"];
}
