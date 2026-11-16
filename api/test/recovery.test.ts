import { describe, expect, it, vi } from "vitest";
import type { MoharChain } from "../src/chain/mohar-chain.js";
import type { Partner, TransactionRecord } from "../src/domain/types.js";
import { RateLimiter } from "../src/http/rate-limit.js";
import { SerialQueue } from "../src/lib/queue.js";
import { SettlementService } from "../src/services/settlement.js";
import type { WebhookSender } from "../src/services/webhooks.js";
import { Store } from "../src/store/store.js";
import type { MockVault } from "../src/vault/mock-vault.js";

const partner: Partner = { slug: "demo-bank", partnerId: "0x01" };

function txn(id: string, patch: Partial<TransactionRecord>): TransactionRecord {
  return {
    id,
    partnerSlug: "demo-bank",
    type: "mint",
    status: "pending",
    walletId: "wal_1",
    grams: "100",
    createdAt: `2026-11-16T10:00:0${id.slice(-1)}Z`,
    ...patch,
  };
}

/** A store holding the given unfinished trades, and a chain that knows some receipts. */
function setup(
  records: TransactionRecord[],
  outcomes: Record<string, { succeeded: boolean; blockNumber: bigint } | undefined>,
) {
  const store = new Store(null);
  store.open("unit");
  for (const record of records) store.saveTransaction(record);
  const waitForOutcome = vi.fn(async (hash: string) => outcomes[hash]);
  const send = vi.fn();
  const service = new SettlementService(
    { waitForOutcome } as unknown as MoharChain,
    {} as MockVault,
    store,
    new SerialQueue(),
    { send } as unknown as WebhookSender,
  );
  return { store, service, send, waitForOutcome };
}

describe("recovery after a restart", () => {
  it("fails a trade that was never sent, and tells the partner", async () => {
    const s = setup([txn("txn_1", { status: "pending" })], {});
    const summary = await s.service.recover(() => partner);

    expect(summary).toEqual({ confirmed: 0, failed: 1, stillWaiting: 0 });
    expect(s.store.getTransaction("txn_1")).toMatchObject({
      status: "failed",
      failureCode: "internal_error",
    });
    expect(s.waitForOutcome).not.toHaveBeenCalled(); // no hash, nothing to look up
    expect(s.send).toHaveBeenCalledExactlyOnceWith(
      partner,
      "transaction.failed",
      expect.objectContaining({ id: "txn_1" }),
    );
  });

  it("confirms or fails a sent trade exactly as the chain says", async () => {
    const s = setup(
      [
        txn("txn_1", { status: "submitted", txHash: "0xaa" }),
        txn("txn_2", { status: "submitted", txHash: "0xbb" }),
      ],
      {
        "0xaa": { succeeded: true, blockNumber: 77n },
        "0xbb": { succeeded: false, blockNumber: 78n },
      },
    );
    const summary = await s.service.recover(() => partner);

    expect(summary).toEqual({ confirmed: 1, failed: 1, stillWaiting: 0 });
    expect(s.store.getTransaction("txn_1")).toMatchObject({ status: "confirmed", blockNumber: 77 });
    expect(s.store.getTransaction("txn_2")).toMatchObject({ status: "failed" });
    expect(s.send.mock.calls.map((call) => call[1])).toEqual([
      "transaction.confirmed",
      "transaction.failed",
    ]);
  });

  it("leaves a sent trade alone while it has no receipt: it may still be mined", async () => {
    const s = setup([txn("txn_1", { status: "submitted", txHash: "0xcc" })], { "0xcc": undefined });
    const summary = await s.service.recover(() => partner, 5);

    expect(summary).toEqual({ confirmed: 0, failed: 0, stillWaiting: 1 });
    expect(s.store.getTransaction("txn_1")?.status).toBe("submitted");
    expect(s.send).not.toHaveBeenCalled();
  });

  it("does not touch trades that already finished", async () => {
    const s = setup(
      [txn("txn_1", { status: "confirmed", txHash: "0xdd" }), txn("txn_2", { status: "failed" })],
      {},
    );
    expect(await s.service.recover(() => partner)).toEqual({
      confirmed: 0,
      failed: 0,
      stillWaiting: 0,
    });
    expect(s.send).not.toHaveBeenCalled();
  });

  it("clears requests that were still running, so a retry can run", () => {
    const store = new Store(null);
    store.open("unit");
    const at = "2026-11-16T10:00:00Z";
    store.saveIdempotency("a", { requestHash: "h", inProgress: true, createdAt: at });
    store.saveIdempotency("b", { requestHash: "h", inProgress: false, status: 202, createdAt: at });

    expect(store.clearInProgressIdempotency()).toBe(1);
    expect(store.getIdempotency("a")).toBeUndefined();
    expect(store.getIdempotency("b")).toBeDefined(); // finished answers are still replayed
  });
});

describe("rate limiter", () => {
  it("allows the limit, refuses the next, and recovers as the window slides", () => {
    let now = 0;
    const limiter = new RateLimiter(2, 60_000, () => now);
    expect(limiter.take("a")).toBe(0);
    now = 20_000;
    expect(limiter.take("a")).toBe(0);
    expect(limiter.take("a")).toBe(40); // the first event leaves the window in 40 s
    expect(limiter.take("b")).toBe(0); // another partner is unaffected
    now = 60_000;
    expect(limiter.take("a")).toBe(0);
  });
});
