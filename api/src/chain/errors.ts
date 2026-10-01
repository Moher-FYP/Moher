import { BaseError, ContractFunctionRevertedError } from "viem";
import type { ErrorCode } from "../errors.js";

export interface ChainFailure {
  code: ErrorCode;
  message: string;
  /** Solidity custom error name, when the chain reverted with one. */
  revert?: string;
}

/** Contract custom errors → the API error codes from docs/openapi.yaml. */
const REVERT_CODES: Record<string, { code: ErrorCode; message: string }> = {
  PriceDeviationTooHigh: {
    code: "price_moved",
    message: "Gold moved more than 0.50% since the quote. Request a new quote.",
  },
  MintingIsPaused: { code: "minting_paused", message: "Minting is paused." },
  WalletNotActive: { code: "wallet_frozen", message: "The wallet is frozen or inactive." },
  ERC20InsufficientBalance: { code: "insufficient_balance", message: "Not enough gold." },
  StalePrice: {
    code: "internal_error",
    message: "The gold price feed is stale. Try again shortly.",
  },
  AttestationExpired: { code: "quote_expired", message: "The vault attestation expired." },
};

export function revertName(error: unknown): string | undefined {
  if (!(error instanceof BaseError)) return undefined;
  const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError);
  if (reverted instanceof ContractFunctionRevertedError) {
    return reverted.data?.errorName ?? undefined;
  }
  return undefined;
}

export function mapChainError(error: unknown): ChainFailure {
  const name = revertName(error);
  if (name) {
    const known = REVERT_CODES[name];
    return known
      ? { ...known, revert: name }
      : { code: "internal_error", message: `Contract reverted: ${name}`, revert: name };
  }
  const message = error instanceof BaseError ? error.shortMessage : String(error);
  return { code: "internal_error", message };
}
