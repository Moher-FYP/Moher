import { createHash, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { keccak256, toHex } from "viem";
import type { Partner } from "../domain/types.js";
import { ApiError } from "../errors.js";

/**
 * Partners and their API keys, from PARTNER_API_KEYS / PARTNER_WEBHOOK_URLS /
 * PARTNER_WEBHOOK_SECRETS. `fallbackSecret` signs for partners with no secret of their own;
 * bootstrap only allows that on local Anvil.
 */
export class PartnerDirectory {
  private readonly byKey = new Map<string, Partner>();
  private readonly bySlug = new Map<string, Partner>();
  /** Keys created in the partner portal (portal/api-keys.ts): key -> partner slug. */
  private keyLookup: ((key: string) => string | undefined) | undefined;

  constructor(apiKeys: string, webhookUrls: string, webhookSecrets = "", fallbackSecret?: string) {
    const urls = new Map(pairs(webhookUrls));
    const secrets = new Map(pairs(webhookSecrets));
    for (const [key, slug] of pairs(apiKeys)) {
      const secret = secrets.get(slug) ?? fallbackSecret;
      const partner = this.bySlug.get(slug) ?? {
        slug,
        partnerId: keccak256(toHex(slug)),
        ...(urls.get(slug) ? { webhookUrl: urls.get(slug) } : {}),
        ...(secret ? { webhookSecret: secret, ownsWebhookSecret: secrets.has(slug) } : {}),
      };
      this.bySlug.set(slug, partner);
      this.byKey.set(key, partner);
    }
  }

  fromApiKey(key: string): Partner | undefined {
    const configured = this.byKey.get(key);
    if (configured) return configured;
    const slug = this.keyLookup?.(key);
    return slug ? this.bySlug.get(slug) : undefined;
  }

  /** Also accept keys from this lookup (the portal's keys). */
  useKeyLookup(lookup: (key: string) => string | undefined): void {
    this.keyLookup = lookup;
  }

  /** The first characters of each key set at start-up, by partner, for the portal's key list. */
  configuredKeyPrefixes(slug: string): string[] {
    return [...this.byKey.entries()]
      .filter(([, partner]) => partner.slug === slug)
      .map(([key]) => key.slice(0, 12));
  }

  get(slug: string): Partner | undefined {
    return this.bySlug.get(slug);
  }

  all(): Partner[] {
    return [...this.bySlug.values()];
  }

  /** Every API key that can authenticate (for the start-up secrets check). */
  apiKeys(): string[] {
    return [...this.byKey.keys()];
  }
}

function pairs(value: string): [string, string][] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const at = item.indexOf("=");
      if (at <= 0) throw new Error(`Expected "name=value", got "${item}"`);
      return [item.slice(0, at).trim(), item.slice(at + 1).trim()];
    });
}

/** Requires `Authorization: Bearer <api key>` and puts the partner on res.locals. */
export function requirePartner(directory: PartnerDirectory) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.header("authorization") ?? "";
    const [scheme, key] = header.split(" ");
    const partner = scheme === "Bearer" && key ? directory.fromApiKey(key) : undefined;
    if (!partner) {
      next(new ApiError(401, "unauthorized", "Missing or invalid API key"));
      return;
    }
    res.locals.partner = partner;
    next();
  };
}

/**
 * Requires `Authorization: Bearer <operator key>` for /dev routes. Deliberately separate from
 * partner keys: a partner must never be able to move the price it trades at. Compared in
 * constant time, on hashes so the two buffers always have the same length.
 */
export function requireOperator(operatorKey: string) {
  const expected = createHash("sha256").update(operatorKey).digest();
  return (req: Request, _res: Response, next: NextFunction): void => {
    const header = req.header("authorization") ?? "";
    const [scheme, key] = header.split(" ");
    const given = createHash("sha256")
      .update(key ?? "")
      .digest();
    if (scheme !== "Bearer" || !key || !timingSafeEqual(expected, given)) {
      next(new ApiError(401, "unauthorized", "Missing or invalid operator key"));
      return;
    }
    next();
  };
}

export function partnerOf(res: Response): Partner {
  return res.locals.partner as Partner;
}
