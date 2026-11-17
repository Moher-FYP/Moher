import "server-only";
import { createHmac } from "node:crypto";
import { partner } from "./partner";

/**
 * A secret from the environment. On a developer's machine a fixed local value stands in, so
 * the demo runs with no setup; in production (next build / next start) a missing or short
 * secret stops the request, because the local value is public in this repository.
 */
export function demoSecret(name: "SESSION_SECRET" | "CUSTOMER_HASH_SECRET"): string {
  const value = process.env[name];
  if (value && value.length >= 32) return value;
  if (process.env.NODE_ENV === "production") {
    throw new Error(`${name} must be set to at least 32 random characters (see .env.example)`);
  }
  return `local-demo-only-${name}-${partner().slug}`;
}

/**
 * A keyed fingerprint of an identity number, so the partner can tell that a CNIC or mobile
 * number was used before without keeping the number itself.
 */
export function fingerprint(kind: "cnic" | "phone", value: string): string {
  return createHmac("sha256", demoSecret("CUSTOMER_HASH_SECRET"))
    .update(`${partner().slug}:${kind}:${value}`)
    .digest("base64url");
}
