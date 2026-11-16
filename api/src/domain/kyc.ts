import { createHmac } from "node:crypto";
import type { Hex } from "viem";

/**
 * The 32-byte fingerprint of a partner's KYC reference that is written on-chain with a wallet.
 *
 * It is an HMAC with a secret only MOHAR holds, not a plain hash. A plain hash of something
 * guessable can be reversed by trying every value: a 13-digit CNIC has only 10^13 of them. With
 * the secret mixed in, the fingerprint on the public chain tells an outsider nothing, while
 * MOHAR can still prove later that a given reference matches it. The partner's slug is part of
 * the input, so the same reference at two partners gives two unrelated fingerprints.
 */
export function kycFingerprint(secret: string, partnerSlug: string, reference: string): Hex {
  const mac = createHmac("sha256", secret).update(`${partnerSlug}\n${reference}`).digest("hex");
  return `0x${mac}`;
}
