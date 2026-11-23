// Shared helpers for the MOHAR acceptance run: the action log, TOTP, HTTP, chain and database reads.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createHmac, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { MoharClient, MoharApiError } from "@mohar/sdk";
import * as viem from "viem";
import { config, REPO } from "./config.mjs";

export { chromium } from "playwright";
export { MoharApiError, REPO, viem };
export const UAT = config.out;
mkdirSync(UAT, { recursive: true });

export const API = config.api;
export const PORTAL_ORIGIN = config.portalOrigin;
export const APPS = config.apps;
export const DEV_KEY = config.devKey;
export const sdk = {
  bank: new MoharClient({ apiKey: APPS.bank.apiKey, baseUrl: API }),
  wallet: new MoharClient({ apiKey: APPS.wallet.apiKey, baseUrl: API }),
};

// ---------------------------------------------------------------- the action log

let seq = 0;
export const context = { round: 0 };
const LOG = `${UAT}/actions.jsonl`;

/**
 * Runs one test action and records it: who did what, in which app, with which ids, what was
 * expected, what happened, and whether that matches. `fn` returns { pass, actual, ids, data }.
 */
export async function step(meta, fn) {
  const started = Date.now();
  let outcome;
  try {
    outcome = await fn();
  } catch (error) {
    outcome = { pass: false, actual: `ERROR: ${String(error?.message ?? error).split("\n")[0]}` };
  }
  const entry = {
    seq: ++seq,
    round: context.round,
    at: new Date(started).toISOString(),
    ms: Date.now() - started,
    app: meta.app,
    actor: meta.actor,
    role: meta.role,
    feature: meta.feature,
    action: meta.action,
    input: meta.input ?? "",
    expected: meta.expected,
    actual: outcome.actual ?? "",
    result: outcome.pass ? "pass" : "FAIL",
    ids: outcome.ids ?? {},
    ...(config.explorer && outcome.ids?.txHash
      ? { link: `${config.explorer}/tx/${outcome.ids.txHash}` }
      : {}),
  };
  appendFileSync(LOG, JSON.stringify(entry) + "\n");
  const mark = outcome.pass ? "  ok " : "FAIL ";
  console.log(
    `${mark}[r${context.round}] ${meta.app} · ${meta.feature} · ${meta.action} → ${entry.actual}`.slice(
      0,
      220,
    ),
  );
  return { ...outcome, entry };
}

export function note(kind, data) {
  appendFileSync(
    `${UAT}/${kind}.jsonl`,
    JSON.stringify({ round: context.round, at: new Date().toISOString(), ...data }) + "\n",
  );
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const uid = () => randomUUID();

// ---------------------------------------------------------------- TOTP (RFC 6238)

const lastCounter = new Map();
export async function totp(secret, who) {
  // Each code works once: wait for a fresh 30-second window if this user just used one.
  let counter = Math.floor(Date.now() / 30000);
  if (lastCounter.get(who) === counter) {
    await sleep(30000 - (Date.now() % 30000) + 300);
    counter = Math.floor(Date.now() / 30000);
  }
  lastCounter.set(who, counter);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of secret.replace(/=+$/, ""))
    bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", key).update(buf).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, "0");
}

// ---------------------------------------------------------------- portal API with a session

/**
 * The portal allows 30 sign-in attempts per IP address in 15 minutes (a security control, and
 * every attempt counts). This run signs in from one address many times, so it keeps under that
 * by waiting when it must, and logs the waits.
 */
const signIns = [];
export async function signInBudget() {
  const window = 15 * 60_000;
  for (;;) {
    const now = Date.now();
    while (signIns.length && now - signIns[0] > window) signIns.shift();
    if (signIns.length < 27) break;
    const wait = window - (now - signIns[0]) + 1000;
    console.log(`   … waiting ${Math.round(wait / 1000)} s for the portal's sign-in limit`);
    await sleep(Math.min(wait, 60_000));
  }
  signIns.push(Date.now());
}

export class PortalSession {
  constructor(user) {
    this.user = user; // { email, password, setupKey, role, partner, id }
    this.cookie = "";
  }
  async signIn(code) {
    await signInBudget();
    const res = await fetch(`${API}/portal/v1/session`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: PORTAL_ORIGIN },
      body: JSON.stringify({
        email: this.user.email,
        password: this.user.password,
        code: code ?? (await totp(this.user.setupKey, this.user.email)),
      }),
    });
    const set = res.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0];
    return { status: res.status, body: await res.json().catch(() => ({})) };
  }
  async call(method, path, body) {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        origin: PORTAL_ORIGIN,
        cookie: this.cookie,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    return { status: res.status, body: json };
  }
}

// ---------------------------------------------------------------- partner API (raw HTTP)

export async function partnerCall(app, method, path, body, headers = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${APPS[app]?.apiKey ?? app}`,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

export async function devPrice(direction) {
  let path = "/dev/price/reset";
  let body = {};
  if (direction !== "reset") {
    const now = Number((await sdk.bank.getPrice()).xauUsd);
    path = "/dev/price";
    body = { xauUsd: (direction === "up" ? now * 1.01 : now * 0.99).toFixed(2) };
  }
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${DEV_KEY}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

// ---------------------------------------------------------------- the API's database, read-only

let db;
export function storeDb() {
  db ??= new DatabaseSync(`${config.dataDir}/store-${config.chainId}.db`, { readOnly: true });
  return db;
}
let pdb;
export function portalDb() {
  pdb ??= new DatabaseSync(`${config.dataDir}/portal.db`, { readOnly: true });
  return pdb;
}
export function walletFor(slug, customerId) {
  const row = storeDb()
    .prepare("SELECT data FROM wallets WHERE partner_slug = ? AND external_customer_id = ?")
    .get(slug, `${slug}-${customerId}`);
  return row ? JSON.parse(row.data) : undefined;
}
export function txnRecord(id) {
  const row = storeDb().prepare("SELECT data FROM transactions WHERE id = ?").get(id);
  return row ? JSON.parse(row.data) : undefined;
}

// ---------------------------------------------------------------- the partner apps' customers

export function customersOf(app) {
  const file = `${REPO}/demo-bank/.data/customers-${APPS[app].slug}.json`;
  // (the same file for local and Amoy runs: the demo apps keep one customer list)
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];
}

// ---------------------------------------------------------------- the chain

export const deployment = JSON.parse(readFileSync(config.deploymentFile, "utf8"));
export const chain = viem.createPublicClient({
  transport: viem.http(config.rpcUrl, { retryCount: 4 }),
});
const tokenAbi = viem.parseAbi([
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function mintingPaused() view returns (bool)",
]);
const registryAbi = viem.parseAbi([
  "function getWallet(address) view returns ((bytes32 partnerId, bytes32 kycAttestationHash, uint64 registeredAt, uint8 status))",
]);
const reserveAbi = viem.parseAbi([
  "function latest() view returns (((uint256 totalGrams, bytes32 allocationsRoot, uint64 asOf, uint256 nonce) attestation, uint256 tokenSupplyAtPublish, uint64 publishedAt))",
  "function attestationCount() view returns (uint256)",
]);
export const onchain = {
  totalSupply: () =>
    chain.readContract({
      address: deployment.moharToken,
      abi: tokenAbi,
      functionName: "totalSupply",
    }),
  balanceOf: (a) =>
    chain.readContract({
      address: deployment.moharToken,
      abi: tokenAbi,
      functionName: "balanceOf",
      args: [a],
    }),
  mintingPaused: () =>
    chain.readContract({
      address: deployment.moharToken,
      abi: tokenAbi,
      functionName: "mintingPaused",
    }),
  walletStatus: async (a) =>
    (
      await chain.readContract({
        address: deployment.walletRegistry,
        abi: registryAbi,
        functionName: "getWallet",
        args: [a],
      })
    ).status,
  latestReserve: () =>
    chain.readContract({
      address: deployment.reserveRegistry,
      abi: reserveAbi,
      functionName: "latest",
    }),
  attestations: () =>
    chain.readContract({
      address: deployment.reserveRegistry,
      abi: reserveAbi,
      functionName: "attestationCount",
    }),
  receipt: (hash) => chain.getTransactionReceipt({ hash }),
  balance: (a) => chain.getBalance({ address: a }),
};

/** "0.60410000" -> 60410000n */
export const gramsUnits = (s) => {
  const [w, f = ""] = String(s).split(".");
  return BigInt(w) * 100000000n + BigInt((f + "00000000").slice(0, 8));
};
