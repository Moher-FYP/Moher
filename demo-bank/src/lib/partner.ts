import "server-only";

/**
 * Which demo partner this copy of the app plays. One codebase, two partners: the point MOHAR
 * makes is that any bank or wallet can offer the same gold product through the same API.
 *
 *   DEMO_PARTNER=bank    Moher Bank, a retail bank (the default)
 *   DEMO_PARTNER=wallet  Moher Wallet, a mobile wallet
 *
 * Both names are invented for the demo. Each partner has its own MOHAR API key, webhook
 * secret and customers; `slug` is the partner's name at MOHAR (PARTNER_API_KEYS).
 */
export interface Partner {
  kind: "bank" | "wallet";
  slug: string;
  name: string;
  initials: string;
  description: string;
  /** Colours for the app's chrome; the gold card looks the same at every partner. */
  colors: { main: string; deep: string };
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
    name: "Moher Bank",
    initials: "MB",
    description: "A retail bank offering gold savings to its account holders",
    colors: { main: "#0e5a43", deep: "#0a4433" },
    newCustomerKyc: "standard",
    kycLabel: "Full account (standard KYC)",
    ownFunds: "Moher Bank current account",
    kycPrefix: "MB-KYC",
    localApiKey: "mk_test_local",
  },
  wallet: {
    kind: "wallet",
    slug: "moher-wallet",
    name: "Moher Wallet",
    initials: "MW",
    description: "A mobile wallet offering gold savings from Rs 100",
    colors: { main: "#5b2a86", deep: "#431f63" },
    newCustomerKyc: "asaan",
    kycLabel: "Asaan account (basic KYC)",
    ownFunds: "Moher Wallet balance",
    kycPrefix: "MW-KYC",
    localApiKey: "mk_test_wallet",
  },
};

export function partner(): Partner {
  return PARTNERS[process.env.DEMO_PARTNER === "wallet" ? "wallet" : "bank"];
}
