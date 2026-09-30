import type { Price, Quote, Transaction, Wallet } from "@mohar/sdk";
import { formatDecimal, formatGrams, formatPkr } from "../domain/money.js";
import { pricePerGramPaisa } from "../domain/pricing.js";
import type { QuoteRecord, TransactionRecord, WalletRecord } from "../domain/types.js";
import type { CurrentPrice } from "../services/price.js";

/** Converts internal records to the exact shapes in docs/openapi.yaml. */

export function toApiPrice(price: CurrentPrice): Price {
  return {
    xauUsd: formatDecimal(price.xauUsdE8 / 1_000_000n, 2),
    usdPkr: formatDecimal(price.usdPkrE4 / 100n, 2),
    pricePerGramPkr: formatPkr(pricePerGramPaisa(price)),
    asOf: new Date(Number(price.updatedAt) * 1000).toISOString(),
    source: price.source,
  };
}

export function toApiWallet(wallet: WalletRecord, active: boolean): Wallet {
  return {
    id: wallet.id,
    externalCustomerId: wallet.externalCustomerId,
    address: wallet.address,
    status: active ? "active" : "frozen",
    createdAt: wallet.createdAt,
  };
}

export function toApiQuote(quote: QuoteRecord): Quote {
  const price: CurrentPrice = {
    xauUsdE8: BigInt(quote.xauUsdE8),
    usdPkrE4: BigInt(quote.usdPkrE4),
    updatedAt: BigInt(quote.priceUpdatedAt),
    source: quote.priceSource,
  };
  return {
    id: quote.id,
    walletId: quote.walletId,
    side: quote.side,
    grams: formatGrams(BigInt(quote.grams)),
    grossAmountPkr: formatPkr(BigInt(quote.grossPaisa)),
    netAmountPkr: formatPkr(BigInt(quote.netPaisa)),
    fees: {
      platformFeePkr: formatPkr(BigInt(quote.platformFeePaisa)),
      fxMarginPkr: formatPkr(BigInt(quote.fxMarginPaisa)),
    },
    price: toApiPrice(price),
    expiresAt: quote.expiresAt,
    createdAt: quote.createdAt,
  };
}

export function toApiTransaction(
  txn: TransactionRecord,
  explorerTxUrl: (hash: `0x${string}`) => string | undefined,
): Transaction {
  const out: Transaction = {
    id: txn.id,
    type: txn.type,
    status: txn.status,
    walletId: txn.walletId,
    grams: formatGrams(BigInt(txn.grams)),
    createdAt: txn.createdAt,
  };
  if (txn.counterpartyWalletId) out.counterpartyWalletId = txn.counterpartyWalletId;
  if (txn.quoteId) out.quoteId = txn.quoteId;
  if (txn.netPaisa) out.netAmountPkr = formatPkr(BigInt(txn.netPaisa));
  if (txn.txHash) {
    out.txHash = txn.txHash;
    const url = explorerTxUrl(txn.txHash);
    if (url) out.explorerUrl = url;
  }
  if (txn.blockNumber !== undefined) out.blockNumber = txn.blockNumber;
  if (txn.failureCode) out.failureCode = txn.failureCode;
  if (txn.confirmedAt) out.confirmedAt = txn.confirmedAt;
  return out;
}
