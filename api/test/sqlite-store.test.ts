import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { TransactionRecord, WalletRecord } from "../src/domain/types.js";
import { PortalStore } from "../src/portal/portal-store.js";
import { Store } from "../src/store/store.js";

/**
 * The SQLite stores as the API and its CLIs use them: two processes on one file. Each test
 * opens two store objects on the same database, which is what the API and `simulate` or
 * `portal:user` do when both run at once.
 */

const dirs: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "mohar-db-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const wallet = (id: string, n: number): WalletRecord => ({
  id,
  partnerSlug: "demo-bank",
  externalCustomerId: `CUST-${n}`,
  address: `0x${String(n).padStart(40, "0")}`,
  kycLevel: "standard",
  kycAttestationHash: `0x${"0".repeat(64)}`,
  derivationIndex: n,
  createdAt: new Date(Date.UTC(2026, 10, 1, 0, n)).toISOString(),
});

const txn = (id: string, walletId: string, minute: number): TransactionRecord => ({
  id,
  partnerSlug: "demo-bank",
  type: "mint",
  status: "confirmed",
  walletId,
  grams: "100000000",
  netPaisa: "100000",
  createdAt: new Date(Date.UTC(2026, 10, 2, 0, minute)).toISOString(),
});

describe("trading store on one SQLite file, two processes", () => {
  it("each sees the other's writes at once, with nothing lost", () => {
    const file = join(tempDir(), "store-31337.db");
    const api = new Store(file);
    const cli = new Store(file);
    api.open("chain-a");
    cli.open("chain-a");

    api.saveWallet(wallet("wal_1", 1));
    cli.saveWallet(wallet("wal_2", 2)); // what the simulator does while the API runs
    api.saveWallet(wallet("wal_3", 3));

    expect(cli.getWallet("wal_1")?.externalCustomerId).toBe("CUST-1");
    expect(api.getWallet("wal_2")?.externalCustomerId).toBe("CUST-2");
    expect(api.allWallets().map((w) => w.id)).toEqual(["wal_1", "wal_2", "wal_3"]);
    api.close();
    cli.close();
  });

  it("never hands out the same derivation index twice", () => {
    const file = join(tempDir(), "store-31337.db");
    const a = new Store(file);
    const b = new Store(file);
    a.open("chain-a");
    b.open("chain-a");
    const seen = [a.nextDerivationIndex(), b.nextDerivationIndex(), a.nextDerivationIndex()];
    expect(seen).toEqual([0, 1, 2]);
  });

  it("keeps its data across a restart, and empties it for a new chain", () => {
    const file = join(tempDir(), "store-31337.db");
    const first = new Store(file);
    first.open("chain-a");
    first.saveWallet(wallet("wal_1", 1));
    first.close();

    const again = new Store(file);
    expect(again.open("chain-a")).toEqual({ reset: false });
    expect(again.getWallet("wal_1")).toBeDefined();
    expect(again.open("chain-b")).toEqual({ reset: true });
    expect(again.getWallet("wal_1")).toBeUndefined();
    expect(again.nextDerivationIndex()).toBe(0);
  });

  it("refuses a second wallet with the same address or customer", () => {
    const store = new Store(null);
    store.open("chain-a");
    store.saveWallet(wallet("wal_1", 1));
    expect(() =>
      store.saveWallet({ ...wallet("wal_2", 2), address: wallet("x", 1).address }),
    ).toThrow(/UNIQUE/);
    expect(() => store.saveWallet({ ...wallet("wal_2", 2), externalCustomerId: "CUST-1" })).toThrow(
      /UNIQUE/,
    );
  });

  it("pages transactions newest first with a cursor", () => {
    const store = new Store(null);
    store.open("chain-a");
    store.saveWallet(wallet("wal_1", 1));
    for (let i = 0; i < 5; i += 1) store.saveTransaction(txn(`txn_${i}`, "wal_1", i));
    const first = store.listTransactions("demo-bank", { limit: 2 });
    expect(first.data.map((t) => t.id)).toEqual(["txn_4", "txn_3"]);
    const second = store.listTransactions("demo-bank", { limit: 2, cursor: first.nextCursor! });
    expect(second.data.map((t) => t.id)).toEqual(["txn_2", "txn_1"]);
    const last = store.listTransactions("demo-bank", { limit: 2, cursor: second.nextCursor! });
    expect(last).toEqual({
      data: [expect.objectContaining({ id: "txn_0" })],
      nextCursor: undefined,
    });
  });

  it("imports the old JSON store once, for the same chain, and keeps the file", () => {
    const dir = tempDir();
    const json = join(dir, "store-80002.json");
    writeFileSync(
      json,
      JSON.stringify({
        chainMarker: "amoy",
        nextDerivationIndex: 7,
        wallets: { wal_1: wallet("wal_1", 1) },
        quotes: {},
        transactions: { txn_1: txn("txn_1", "wal_1", 1) },
        idempotency: { "key-1": { requestHash: "h", inProgress: false, status: 201, body: {} } },
      }),
    );
    const store = new Store(join(dir, "store-80002.db"), json);
    expect(store.open("amoy")).toEqual({ reset: false, imported: 3 });
    expect(store.getTransaction("txn_1")?.walletId).toBe("wal_1");
    expect(store.nextDerivationIndex()).toBe(7);
    expect(existsSync(json)).toBe(false);
    expect(existsSync(`${json}.imported`)).toBe(true);
  });

  it("does not import a JSON store from another chain", () => {
    const dir = tempDir();
    const json = join(dir, "store-31337.json");
    writeFileSync(
      json,
      JSON.stringify({
        chainMarker: "old-anvil",
        nextDerivationIndex: 3,
        wallets: {},
        quotes: {},
        transactions: {},
        idempotency: {},
      }),
    );
    const store = new Store(join(dir, "store-31337.db"), json);
    expect(store.open("new-anvil")).toEqual({ reset: true });
    expect(existsSync(json)).toBe(true);
  });
});

describe("portal store on one SQLite file, two processes", () => {
  it("keeps one unbroken log when two processes append to it", () => {
    const file = join(tempDir(), "portal.db");
    const api = new PortalStore(file);
    const cli = new PortalStore(file);
    api.log("audit", { action: "a1", result: "ok" });
    cli.log("audit", { action: "cli1", result: "ok" }); // portal:user while the API runs
    api.log("audit", { action: "a2", result: "ok" });
    expect(api.rawLog("audit").map((e) => [e.seq, e.action])).toEqual([
      [1, "a1"],
      [2, "cli1"],
      [3, "a2"],
    ]);
    expect(api.verifyLog("audit")).toEqual({ intact: true, entries: 3 });
  });

  it("sees a user added by the CLI without a restart", () => {
    const file = join(tempDir(), "portal.db");
    const api = new PortalStore(file);
    const cli = new PortalStore(file);
    cli.saveUser({
      id: "usr_1",
      email: "ali@demo-bank.test",
      partnerSlug: "demo-bank",
      role: "developer",
      passwordHash: "x",
      totpSecretSealed: "y",
      status: "active",
      failedAttempts: 0,
      createdAt: new Date().toISOString(),
    });
    expect(api.findUserByEmail("Ali@Demo-Bank.test ")?.id).toBe("usr_1");
  });

  it("imports portal.json once, logs and hashes unchanged", () => {
    const dir = tempDir();
    const old = new PortalStore(null);
    old.log("audit", { action: "a1", result: "ok", partner: "demo-bank" });
    old.log("audit", { action: "a2", result: "ok" });
    old.log("security", { action: "s1", result: "refused" });
    const json = join(dir, "portal.json");
    writeFileSync(
      json,
      JSON.stringify({
        version: 1,
        users: {},
        sessions: {},
        logs: { audit: old.rawLog("audit"), security: old.rawLog("security") },
        apiKeys: {},
        partnerSettings: { "demo-bank": { webhookUrl: "https://bank.example/hooks" } },
        deliveries: [],
        freezeRequests: {},
        anchors: [],
      }),
    );
    const store = new PortalStore(join(dir, "portal.db"), undefined, json);
    expect(store.verifyLog("audit")).toEqual({ intact: true, entries: 2 });
    expect(store.head("audit")).toEqual(old.head("audit"));
    expect(store.listLog("audit", { partner: "demo-bank", limit: 10 }).data).toHaveLength(1);
    expect(store.partnerSettings("demo-bank").webhookUrl).toBe("https://bank.example/hooks");
    expect(readFileSync(`${json}.imported`, "utf8")).toContain("a1");
  });
});
