import { describe, expect, it, vi } from "vitest";
import type { MoharChain } from "../src/chain/mohar-chain.js";
import type { Partner, QuoteRecord, WalletRecord } from "../src/domain/types.js";
import { SerialQueue } from "../src/lib/queue.js";
import { SettlementService } from "../src/services/settlement.js";
import type { WebhookSender } from "../src/services/webhooks.js";
import { Store } from "../src/store/store.js";
import type { MockVault } from "../src/vault/mock-vault.js";

const partner: Partner = { slug: "demo-bank", partnerId: "0x01" };
const wallet = {
  id: "wal_1",
  address: "0x0000000000000000000000000000000000000001",
} as unknown as WalletRecord;
const quote = (id: string) =>
  ({ id, grams: "100", xauUsdE8: "461600000000", netPaisa: "2500000" }) as QuoteRecord;

/** A settlement service on a fake chain that counts what it sends, in order. */
function setup(intervalSeconds = 0) {
  const store = new Store(null);
  store.open("unit");
  const sent: string[] = [];
  let block = 1n;
  const chain = {
    chainId: 31337,
    latestBlockTimestamp: async () => 1_800_000_000n,
    getBlock: async () => ({ timestamp: 1_800_000_000n }),
    getBlockNumber: async () => block,
    mint: async () => {
      sent.push("mint");
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { hash: `0x${(block++).toString(16).padStart(64, "0")}`, blockNumber: block };
    },
    publishReserve: async () => {
      sent.push("reserve");
      return { hash: "0xreserve", blockNumber: block };
    },
  } as unknown as MoharChain;
  const vault = {
    allocate: vi.fn(),
    releaseAllocation: vi.fn(),
    signAllocation: async () => "0xsig",
    nextAttestation: () => ({}),
    signReserve: async () => "0xsig",
  } as unknown as MockVault;
  const send = vi.fn();
  const queue = new SerialQueue();
  const service = new SettlementService(
    chain,
    vault,
    store,
    queue,
    { send } as unknown as WebhookSender,
    intervalSeconds,
  );
  return { service, sent, send, store };
}

describe("reserve proofs", () => {
  it("still follow a single trade, as before", async () => {
    const { service, sent } = setup();
    service.startMint(partner, quote("qt_1"), wallet);
    await service.idle();
    expect(sent).toEqual(["mint", "reserve"]);
  });

  it("cover a burst of trades with one proof, sent after the last of them", async () => {
    const { service, sent, store } = setup();
    for (const id of ["qt_1", "qt_2", "qt_3", "qt_4", "qt_5"]) {
      service.startMint(partner, quote(id), wallet);
    }
    await service.idle();
    expect(sent).toEqual(["mint", "mint", "mint", "mint", "mint", "reserve"]);
    expect(store.transactionsOf("demo-bank").every((t) => t.status === "confirmed")).toBe(true);
  });

  it("wait out the interval when one is set", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout"], shouldAdvanceTime: true });
    try {
      const { service, sent } = setup(60);
      service.startMint(partner, quote("qt_1"), wallet);
      await service.idle();
      expect(sent).toEqual(["mint", "reserve"]); // the first proof goes out at once

      service.startMint(partner, quote("qt_2"), wallet);
      await service.idle();
      service.startMint(partner, quote("qt_3"), wallet);
      await service.idle();
      expect(sent).toEqual(["mint", "reserve", "mint", "mint"]); // waiting for the minute

      await vi.advanceTimersByTimeAsync(60_000);
      await service.idle();
      expect(sent).toEqual(["mint", "reserve", "mint", "mint", "reserve"]);
      service.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
