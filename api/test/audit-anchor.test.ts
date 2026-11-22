import { stringToHex, type Address, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { AuditAnchor, type AnchorSigner } from "../src/portal/anchor.js";
import { PortalStore } from "../src/portal/portal-store.js";

const KEY = "0x90F79bf6EB2c4f870365E785982E1f101E93b906" as Address;

/** A chain that keeps the anchor transactions it was sent, which a test can tamper with. */
function fakeChain() {
  const txs = new Map<string, { from: Address; to: Address | null; input: Hex }>();
  const signer: AnchorSigner = {
    address: KEY,
    anchor: async (data) => {
      const hash = `0x${(txs.size + 1).toString(16).padStart(64, "0")}` as Hex;
      txs.set(hash, { from: KEY, to: KEY, input: data });
      return hash;
    },
    transactionData: async (hash) => txs.get(hash),
  };
  return { signer, txs };
}

function logs(store: PortalStore, n: number) {
  for (let i = 0; i < n; i += 1) {
    store.log("audit", { action: `change ${i}`, result: "ok" });
    store.log("security", { action: "session.create", result: "ok" });
  }
}

describe("audit log anchors", () => {
  it("write both logs' heads on-chain, and skip when nothing changed", async () => {
    const store = new PortalStore(null);
    const { signer, txs } = fakeChain();
    const anchor = new AuditAnchor(store, signer);
    expect(await anchor.anchorNow()).toBeUndefined(); // empty logs: nothing to anchor

    logs(store, 3);
    const first = await anchor.anchorNow();
    expect(first).toMatchObject({ audit: { seq: 3 }, security: { seq: 3 } });
    expect(txs.size).toBe(1);
    expect(await anchor.anchorNow()).toBeUndefined();
    expect(txs.size).toBe(1);
    expect(await anchor.verify()).toMatchObject({ anchors: 1, intact: true });
  });

  it("catch a log rewritten in full, which the hash chain alone cannot", async () => {
    const store = new PortalStore(null);
    const anchor = new AuditAnchor(store, fakeChain().signer);
    logs(store, 3);
    await anchor.anchorNow();

    // Rewrite entry 2 and recompute every hash after it, so the chain itself checks out.
    const forged = new PortalStore(null);
    for (const e of store.rawLog("audit")) {
      forged.log("audit", { action: e.seq === 2 ? "something else" : e.action, result: e.result });
    }
    store.unsafeSqlForTests("DELETE FROM log_entries WHERE log = 'audit'");
    for (const e of forged.rawLog("audit")) {
      store.unsafeSqlForTests(
        "INSERT INTO log_entries (log, seq, partner, data) VALUES ('audit', ?, NULL, ?)",
        e.seq,
        JSON.stringify(e),
      );
    }
    expect(store.verifyLog("audit").intact).toBe(true);

    const check = await anchor.verify();
    expect(check.intact).toBe(false);
    expect(check.problem).toMatch(/audit log's entry 3 differs/);
  });

  it("catch an anchor record edited in the file", async () => {
    const store = new PortalStore(null);
    const { signer } = fakeChain();
    const anchor = new AuditAnchor(store, signer);
    logs(store, 2);
    await anchor.anchorNow();
    store.unsafeSqlForTests(
      "UPDATE anchors SET data = json_set(data, '$.audit.hash', ?) WHERE ord = 1",
      "f".repeat(64),
    );
    expect((await anchor.verify()).problem).toMatch(/does not say what the file records/);
  });

  it("refuse an anchor sent by some other key", async () => {
    const store = new PortalStore(null);
    const { signer, txs } = fakeChain();
    const anchor = new AuditAnchor(store, signer);
    logs(store, 1);
    const record = (await anchor.anchorNow())!;
    txs.set(record.txHash, {
      from: "0x0000000000000000000000000000000000000bad",
      to: KEY,
      input: stringToHex("anything"),
    });
    expect((await anchor.verify()).problem).toMatch(/not sent by the compliance key/);
  });
});
