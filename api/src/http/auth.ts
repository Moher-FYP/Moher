import type { NextFunction, Request, Response } from "express";
import { keccak256, toHex } from "viem";
import type { Partner } from "../domain/types.js";
import { ApiError } from "../errors.js";

/** Partners and their API keys, from PARTNER_API_KEYS / PARTNER_WEBHOOK_URLS. */
export class PartnerDirectory {
  private readonly byKey = new Map<string, Partner>();
  private readonly bySlug = new Map<string, Partner>();

  constructor(apiKeys: string, webhookUrls: string) {
    const urls = new Map(pairs(webhookUrls));
    for (const [key, slug] of pairs(apiKeys)) {
      const partner = this.bySlug.get(slug) ?? {
        slug,
        partnerId: keccak256(toHex(slug)),
        ...(urls.get(slug) ? { webhookUrl: urls.get(slug) } : {}),
      };
      this.bySlug.set(slug, partner);
      this.byKey.set(key, partner);
    }
  }

  fromApiKey(key: string): Partner | undefined {
    return this.byKey.get(key);
  }

  get(slug: string): Partner | undefined {
    return this.bySlug.get(slug);
  }

  all(): Partner[] {
    return [...this.bySlug.values()];
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

export function partnerOf(res: Response): Partner {
  return res.locals.partner as Partner;
}
