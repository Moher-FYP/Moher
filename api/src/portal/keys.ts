import { createHash, randomBytes } from "node:crypto";
import type { PartnerDirectory } from "../http/auth.js";
import type { PortalStore } from "./portal-store.js";
import type { Sealer } from "./sealed.js";

/**
 * API keys and webhook secrets made in the portal. Both are 256 random bits, shown once, and
 * stored only as what is needed: a key as its SHA-256 (a hash is enough to recognise it, and a
 * stolen file cannot be used to call the API), a webhook secret sealed (MOHAR must sign with
 * it, so it has to be recoverable).
 */

export const KEY_PREFIX = "mk_test_";

export function newApiKey(): string {
  return KEY_PREFIX + randomBytes(32).toString("base64url");
}

export function newWebhookSecret(): string {
  return "whsec_" + randomBytes(32).toString("base64url");
}

export function keyHash(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/** For PartnerDirectory.useKeyLookup: a live portal key -> its partner. Notes when it was used. */
export function portalKeyLookup(store: PortalStore, now: () => Date = () => new Date()) {
  return (key: string): string | undefined => {
    if (!key.startsWith(KEY_PREFIX)) return undefined;
    const record = store.findLiveKeyByHash(keyHash(key));
    if (!record) return undefined;
    // In memory only: saved with the next real write, not on every request.
    store.updateApiKey(record.id, { lastUsedAt: now().toISOString() });
    return record.partnerSlug;
  };
}

/**
 * Applies webhook URLs and secrets that partners set in the portal over the start-up
 * configuration, and lets the directory accept portal keys. Called once at start-up.
 */
export function applyPortalSettings(
  directory: PartnerDirectory,
  store: PortalStore,
  sealer: Sealer,
): void {
  directory.useKeyLookup(portalKeyLookup(store));
  for (const [slug, settings] of Object.entries(store.allPartnerSettings())) {
    const partner = directory.get(slug);
    if (!partner) continue;
    if (settings.webhookUrl) partner.webhookUrl = settings.webhookUrl;
    if (settings.webhookSecretSealed) {
      partner.webhookSecret = sealer.open(settings.webhookSecretSealed);
      partner.ownsWebhookSecret = true;
    }
  }
}
