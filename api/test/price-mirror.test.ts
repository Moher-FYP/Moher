import { describe, expect, it, vi } from "vitest";
import {
  checkReference,
  REFERENCE_BOUNDS,
  type ReferenceFeed,
} from "../src/chain/reference-feed.js";
import { loadConfig } from "../src/config.js";
import { SerialQueue } from "../src/lib/queue.js";
import { PriceService, type PriceChain } from "../src/services/price.js";

const E8 = 10n ** 8n;
const usd = (dollars: number) => BigInt(Math.round(dollars * 100)) * (E8 / 100n);

/** A mock feed in memory: the price the contracts would read, and when it was set. */
function fakeChain(start: bigint, maxStaleness = 3_600) {
  let answer = start;
  let updatedAt = 1_000n;
  let chainTime = 1_000n;
  const setMockPrice = vi.fn(async (next: bigint) => {
    answer = next;
    updatedAt = chainTime;
    return { hash: "0x01" as const, blockNumber: 1n };
  });
  const chain: PriceChain = {
    deployment: { mockFeed: true, maxStaleness } as PriceChain["deployment"],
    latestPrice: async () => ({ xauUsdE8: answer, updatedAt }),
    mockFeedAnswer: async () => ({ answer, updatedAt }),
    mockFeedInitialAnswer: async () => start,
    setMockPrice,
    latestBlockTimestamp: async () => chainTime,
  };
  return {
    chain,
    setMockPrice,
    price: () => answer,
    advance: (seconds: bigint) => (chainTime += seconds),
  };
}

function service(start: bigint, reference: ReferenceFeed, holdSeconds = 600) {
  const fake = fakeChain(start);
  let nowMs = 0;
  const price = new PriceService(
    fake.chain,
    new SerialQueue(),
    2_790_500n,
    { feed: reference, minMoveBps: 20n, intervalSeconds: 120, holdSeconds },
    () => nowMs,
  );
  return { ...fake, service: price, wait: (seconds: number) => (nowMs += seconds * 1000) };
}

const fixedReference = (answer: bigint): ReferenceFeed => ({
  read: async () => ({ answer, updatedAt: 1_000n }),
});

describe("price mirror", () => {
  it("copies the reference price once it has moved 0.20% or more", async () => {
    const s = service(usd(4616), fixedReference(usd(4700)));
    await s.service.tick();
    expect(s.price()).toBe(usd(4700));
    expect(s.setMockPrice).toHaveBeenCalledTimes(1);
  });

  it("spends no gas on a move smaller than the threshold", async () => {
    const s = service(usd(4700), fixedReference(usd(4704.7))); // 0.10%
    await s.service.tick();
    expect(s.price()).toBe(usd(4700));
    expect(s.setMockPrice).not.toHaveBeenCalled();
  });

  it("follows the reference down as well as up", async () => {
    const s = service(usd(4700), fixedReference(usd(4653)));
    await s.service.tick();
    expect(s.price()).toBe(usd(4653));
  });

  it("holds a manual demo price, then returns to the reference", async () => {
    const s = service(usd(4700), fixedReference(usd(4700)));
    await s.service.setMockPrice(usd(4747)); // the "Gold up 1%" button
    await s.service.tick();
    expect(s.price()).toBe(usd(4747));

    s.wait(601);
    await s.service.tick();
    expect(s.price()).toBe(usd(4700));
  });

  it("reset returns to the reference at once, even inside the hold", async () => {
    const s = service(usd(4700), fixedReference(usd(4701))); // closer than the 0.20% threshold
    await s.service.setMockPrice(usd(4747));
    const price = await s.service.resetMockPrice();
    expect(price.xauUsdE8).toBe(usd(4701));

    // The hold is over too: the mirror follows the reference again straight away.
    await s.service.tick();
    expect(s.price()).toBe(usd(4701));
  });

  it("reset without a mirror returns to the price the feed started with", async () => {
    const fake = fakeChain(usd(4616));
    const plain = new PriceService(fake.chain, new SerialQueue(), 2_790_500n);
    await plain.setMockPrice(usd(4662.16));
    expect((await plain.resetMockPrice()).xauUsdE8).toBe(usd(4616));
  });

  it("keeps the current price when the reference cannot be read", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const s = service(usd(4700), {
      read: async () => {
        throw new Error("mainnet RPC is down");
      },
    });
    await expect(s.service.tick()).resolves.toBeUndefined();
    expect(s.price()).toBe(usd(4700));
    expect(s.setMockPrice).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("still re-publishes an ageing price when the reference is unavailable", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const s = service(usd(4700), {
      read: async () => {
        throw new Error("mainnet RPC is down");
      },
    });
    s.advance(1_801n); // more than half of the 3,600-second staleness limit
    await s.service.tick();
    expect(s.setMockPrice).toHaveBeenCalledExactlyOnceWith(usd(4700));
    error.mockRestore();
  });

  it("does nothing when the deployment reads a real feed", async () => {
    const s = service(usd(4616), fixedReference(usd(4700)));
    (s.chain.deployment as { mockFeed: boolean }).mockFeed = false;
    await s.service.tick();
    expect(s.setMockPrice).not.toHaveBeenCalled();
  });
});

describe("reference price checks", () => {
  const now = 1_000_000n;
  const day = 86_400n;

  it("accepts a plausible, recent gold price", () => {
    const price = { answer: usd(4700), updatedAt: now - day };
    expect(checkReference(price, now, 4n * day)).toBe(price);
  });

  it("rejects zero, negative and implausible values", () => {
    for (const answer of [0n, -1n, REFERENCE_BOUNDS.minE8 - 1n, REFERENCE_BOUNDS.maxE8 + 1n]) {
      expect(() => checkReference({ answer, updatedAt: now }, now, day)).toThrow(/plausible/);
    }
  });

  it("rejects a reference older than the limit", () => {
    const price = { answer: usd(4700), updatedAt: now - 5n * day };
    expect(() => checkReference(price, now, 4n * day)).toThrow(/older/);
  });
});

describe("configuration", () => {
  it("treats a line left blank in .env as not set", () => {
    const config = loadConfig({
      RELAYER_PRIVATE_KEY: "",
      WALLET_MNEMONIC: "",
      ENABLE_DEV_ROUTES: "",
      MIRROR_RPC_URL: "",
      MIRROR_FEED_ADDRESS: "",
    });
    expect(config.RELAYER_PRIVATE_KEY).toBeUndefined();
    expect(config.WALLET_MNEMONIC).toBeUndefined();
    expect(config.ENABLE_DEV_ROUTES).toBeUndefined();
    expect(config.MIRROR_RPC_URL).toBeUndefined();
  });

  it("rejects a mirror address that is not an address", () => {
    expect(() => loadConfig({ MIRROR_FEED_ADDRESS: "xau-usd.data.eth" })).toThrow(
      /MIRROR_FEED_ADDRESS/,
    );
  });
});
