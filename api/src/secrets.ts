import type { Partner } from "./domain/types.js";

/**
 * Secrets that are written in this repository so the local demo works with no setup. Anyone who
 * has read the repo knows them, so they are only acceptable on a local Anvil chain.
 */
export const LOCAL_ONLY = {
  partnerApiKeys: "mk_test_local=demo-bank,mk_test_wallet=moher-wallet",
  webhookSecret: "whsec_local_dev_only",
  devApiKey: "mk_dev_local",
  kycHashSecret: "kyc_local_dev_only",
} as const;

const KNOWN_TO_EVERYONE = new Set<string>([
  "mk_test_local",
  "mk_test_wallet",
  LOCAL_ONLY.webhookSecret,
  LOCAL_ONLY.devApiKey,
  LOCAL_ONLY.kycHashSecret,
]);

/** Shortest secret accepted off the local chain. `openssl rand -hex 24` gives 48 characters. */
export const MIN_SECRET_LENGTH = 24;

export interface SecretsInUse {
  /** Every partner API key that can authenticate. */
  apiKeys: readonly string[];
  partners: readonly Partner[];
  /** The key for /dev routes, when those routes are on. */
  devApiKey?: string | undefined;
  devRoutes: boolean;
  /** Keys the on-chain KYC fingerprints (domain/kyc.ts). */
  kycHashSecret?: string | undefined;
}

/**
 * Lists what is wrong with the secrets for a chain other than local Anvil. Empty = fine.
 * Messages name the setting to fix and never contain a secret's value.
 */
export function findWeakSecrets(inUse: SecretsInUse): string[] {
  const problems: string[] = [];
  const weak = (value: string): string | undefined => {
    if (KNOWN_TO_EVERYONE.has(value)) return "is the repo's local default, which is public";
    if (value.length < MIN_SECRET_LENGTH) return `is shorter than ${MIN_SECRET_LENGTH} characters`;
    return undefined;
  };

  inUse.apiKeys.forEach((key, index) => {
    const reason = weak(key);
    if (reason) problems.push(`PARTNER_API_KEYS: key ${index + 1} ${reason}`);
  });

  const secretOwners = new Map<string, string>();
  for (const partner of inUse.partners) {
    if (!partner.webhookUrl) continue;
    if (!partner.webhookSecret || !partner.ownsWebhookSecret) {
      problems.push(
        `PARTNER_WEBHOOK_SECRETS: no secret for "${partner.slug}". Each partner with a webhook needs its own`,
      );
      continue;
    }
    const reason = weak(partner.webhookSecret);
    if (reason)
      problems.push(`PARTNER_WEBHOOK_SECRETS: the secret for "${partner.slug}" ${reason}`);
    const other = secretOwners.get(partner.webhookSecret);
    if (other) {
      problems.push(
        `PARTNER_WEBHOOK_SECRETS: "${partner.slug}" and "${other}" share a secret, so one could forge the other's webhooks`,
      );
    }
    secretOwners.set(partner.webhookSecret, partner.slug);
  }

  if (!inUse.kycHashSecret) {
    problems.push("KYC_HASH_SECRET: required. It keeps on-chain KYC fingerprints unguessable");
  } else {
    const reason = weak(inUse.kycHashSecret);
    if (reason) problems.push(`KYC_HASH_SECRET: ${reason}`);
  }

  if (inUse.devRoutes) {
    if (!inUse.devApiKey) {
      problems.push("DEV_API_KEY: required when ENABLE_DEV_ROUTES=true");
    } else {
      const reason = weak(inUse.devApiKey);
      if (reason) problems.push(`DEV_API_KEY: ${reason}`);
      if (inUse.apiKeys.includes(inUse.devApiKey)) {
        problems.push("DEV_API_KEY: must differ from every partner API key");
      }
    }
  }
  return problems;
}
