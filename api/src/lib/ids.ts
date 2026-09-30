import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** Prefixed random id, e.g. newId("wal") -> "wal_7Hq2Lx9PbQ3m". */
export function newId(prefix: "wal" | "qt" | "txn" | "evt", length = 14): string {
  const bytes = randomBytes(length);
  let id = "";
  for (const byte of bytes) id += ALPHABET[byte % ALPHABET.length];
  return `${prefix}_${id}`;
}
