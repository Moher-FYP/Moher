import type { Address, Hex } from "viem";

/**
 * Persisted records. Amounts are stored as integer strings (bigint does not survive JSON):
 * grams in 1e-8 g units, PKR in paisa, prices in the on-chain fixed-point format.
 */

export interface Partner {
  /** Short name used in API keys and webhooks config, e.g. "demo-bank". */
  slug: string;
  /** keccak256(slug) — the id registered in WalletRegistry. */
  partnerId: Hex;
  webhookUrl?: string;
}

export interface WalletRecord {
  id: string;
  partnerSlug: string;
  externalCustomerId: string;
  address: Address;
  kycLevel: "asaan" | "standard" | "enhanced";
  kycAttestationHash: Hex;
  derivationIndex: number;
  createdAt: string;
}

export interface QuoteRecord {
  id: string;
  partnerSlug: string;
  walletId: string;
  side: "buy" | "sell";
  grams: string;
  grossPaisa: string;
  netPaisa: string;
  fxMarginPaisa: string;
  platformFeePaisa: string;
  xauUsdE8: string;
  usdPkrE4: string;
  priceUpdatedAt: string;
  priceSource: "chainlink" | "mock";
  expiresAt: string;
  createdAt: string;
  usedByTransactionId?: string;
}

export type TransactionStatus = "pending" | "submitted" | "confirmed" | "failed";

export interface TransactionRecord {
  id: string;
  partnerSlug: string;
  type: "mint" | "burn" | "transfer";
  status: TransactionStatus;
  walletId: string;
  counterpartyWalletId?: string;
  grams: string;
  quoteId?: string;
  netPaisa?: string;
  txHash?: Hex;
  blockNumber?: number;
  failureCode?: string;
  failureMessage?: string;
  createdAt: string;
  confirmedAt?: string;
}

export interface IdempotencyRecord {
  requestHash: string;
  inProgress: boolean;
  status?: number;
  body?: unknown;
  createdAt: string;
}
