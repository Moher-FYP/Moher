import { createHmac, randomBytes } from "node:crypto";

/**
 * One-time codes from an authenticator app (RFC 6238 TOTP: HMAC-SHA1, 30-second steps,
 * 6 digits), written here rather than pulled in as a dependency because it is short and the
 * team must be able to explain every line. Tested against the RFC's own vectors.
 */

export const STEP_SECONDS = 30;
const DIGITS = 6;
/** Accept the code for the step before and after, for clocks a little out. */
const DRIFT_STEPS = 1;

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** A new secret: 20 random bytes (160 bits, as RFC 4226 recommends), in base32. */
export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** The link an authenticator app reads from a QR code. */
export function otpauthUri(secret: string, email: string, issuer = "MOHAR Portal"): string {
  const label = encodeURIComponent(`${issuer}:${email}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** The code for a given step counter (floor(unixSeconds / 30)). */
export function codeAt(secret: string, counter: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", base32Decode(secret)).update(message).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binary =
    ((hmac[offset]! & 0x7f) << 24) |
    (hmac[offset + 1]! << 16) |
    (hmac[offset + 2]! << 8) |
    hmac[offset + 3]!;
  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

export function counterAt(unixSeconds: number): number {
  return Math.floor(unixSeconds / STEP_SECONDS);
}

/**
 * Checks a code. Returns the step it matched, so the caller can refuse that step (and any
 * earlier one) next time: a code works once. Returns undefined if it matches no allowed step.
 */
export function verifyCode(
  secret: string,
  code: string,
  unixSeconds: number,
  lastUsedCounter: number | undefined,
): number | undefined {
  if (!/^\d{6}$/.test(code)) return undefined;
  const now = counterAt(unixSeconds);
  for (let counter = now - DRIFT_STEPS; counter <= now + DRIFT_STEPS; counter += 1) {
    if (lastUsedCounter !== undefined && counter <= lastUsedCounter) continue;
    if (constantTimeEqual(codeAt(secret, counter), code)) return counter;
  }
  return undefined;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/=+$/, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error("Not a base32 secret");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
