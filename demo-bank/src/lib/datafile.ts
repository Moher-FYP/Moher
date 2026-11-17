import "server-only";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { partner } from "./partner";

// The demo keeps its records in small JSON files, one set per partner, so they survive a
// restart. A real partner keeps them in its core banking system. Files are readable by the
// owner only, and hold no CNIC, phone number or account number in the clear.
const DATA_DIR = join(process.cwd(), ".data");
const fileFor = (name: string) => join(DATA_DIR, `${name}-${partner().slug}.json`);

/** The saved value, or `fallback` if there is none yet. */
export function readData<T>(name: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(fileFor(name), "utf8")) as T;
  } catch {
    return fallback;
  }
}

/** Saves the value whole: written to a temporary file first, so a crash never leaves half. */
export function writeData(name: string, value: unknown): void {
  mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  const tmp = `${fileFor(name)}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  renameSync(tmp, fileFor(name));
}
