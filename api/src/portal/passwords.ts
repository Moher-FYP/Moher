import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { hash, verify } from "@node-rs/argon2";

/**
 * Portal passwords, following NIST SP 800-63B-4 and OWASP's Password Storage Cheat Sheet:
 * a length rule and a blocklist instead of "one capital, one symbol" rules, no forced changes,
 * and Argon2id with OWASP's first recommended setting (19 MiB, 2 passes, 1 thread).
 */

export const MIN_LENGTH = 12;
export const MAX_LENGTH = 128;

const ARGON2ID = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

let blocklist: Set<string> | undefined;

/**
 * 46,146 common passwords of 12 or more characters, lower-cased, from the xato-net 1M list in
 * SecLists (MIT licence). Shorter ones are refused by the length rule anyway.
 */
function commonPasswords(): Set<string> {
  blocklist ??= new Set(
    gunzipSync(readFileSync(new URL("../../data/common-passwords-12plus.txt.gz", import.meta.url)))
      .toString("utf8")
      .split("\n")
      .filter(Boolean),
  );
  return blocklist;
}

/** Why a new password is not allowed, or undefined if it is fine. */
export function passwordProblem(password: string, email: string): string | undefined {
  const length = [...password].length;
  if (length < MIN_LENGTH) return `Use at least ${MIN_LENGTH} characters`;
  if (length > MAX_LENGTH) return `Use at most ${MAX_LENGTH} characters`;
  const lower = password.toLowerCase();
  if (new Set(lower).size < 4) return "Use more than three different characters";
  if (commonPasswords().has(lower)) return "This password is on a list of common passwords";
  const name = email.split("@")[0]?.toLowerCase() ?? "";
  if ((name.length >= 4 && lower.includes(name)) || lower.includes("mohar")) {
    return "Do not build the password from your email or the word MOHAR";
  }
  return undefined;
}

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2ID);
}

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  try {
    return await verify(stored, password);
  } catch {
    return false;
  }
}

/**
 * Hashed once at start-up and checked when the email is unknown, so a wrong email takes as
 * long as a wrong password and the timing does not reveal which accounts exist.
 */
let dummy: Promise<string> | undefined;
export function dummyHash(): Promise<string> {
  dummy ??= hashPassword("not-a-real-password-for-timing");
  return dummy;
}

/** A new random password: 24 characters (144 bits), so nobody has to choose one. */
export function generatePassword(email: string): string {
  for (;;) {
    const candidate = randomBytes(18).toString("base64url");
    if (!passwordProblem(candidate, email)) return candidate;
  }
}
