import type { MoharChain } from "../chain/mohar-chain.js";
import { revertName } from "../chain/errors.js";
import type { ReferenceFeed } from "../chain/reference-feed.js";
import type { SerialQueue } from "../lib/queue.js";

/** The part of MoharChain the price service uses (narrow, so tests can pass a fake). */
export type PriceChain = Pick<
  MoharChain,
  | "deployment"
  | "latestPrice"
  | "mockFeedAnswer"
  | "mockFeedInitialAnswer"
  | "setMockPrice"
  | "latestBlockTimestamp"
>;

/** Makes the mock feed follow a real XAU/USD feed on another chain. */
export interface MirrorOptions {
  feed: ReferenceFeed;
  /** Copy the reference once it differs from the mock by at least this much. */
  minMoveBps: bigint;
  /** How often to compare the two. Comparing is free; only a copy costs gas. */
  intervalSeconds: number;
  /** After a manual /dev/price move, leave the mock alone for this long. */
  holdSeconds: number;
}

export interface CurrentPrice {
  /** USD per troy ounce, 8 decimals (from the on-chain feed). */
  xauUsdE8: bigint;
  /** PKR per USD, 4 decimals (off-chain configuration). */
  usdPkrE4: bigint;
  /** Chain time the feed was last updated (seconds). */
  updatedAt: bigint;
  source: "chainlink" | "mock";
}

/**
 * Reads the gold price through MoharToken.latestPrice(), so the API sees exactly the price and
 * staleness rules the contract enforces. With the mock feed, a keeper re-publishes the current
 * answer before it goes stale — the stand-in for Chainlink's heartbeat. With a mirror, the
 * keeper also copies a real XAU/USD feed into the mock, so a testnet shows the market price.
 */
export class PriceService {
  private keeper: NodeJS.Timeout | undefined;
  private holdUntilMs = 0;

  constructor(
    private readonly chain: PriceChain,
    private readonly queue: SerialQueue,
    private readonly usdPkrE4: bigint,
    private readonly mirror?: MirrorOptions,
    private readonly nowMs: () => number = Date.now,
  ) {}

  get source(): "chainlink" | "mock" {
    return this.chain.deployment.mockFeed ? "mock" : "chainlink";
  }

  async current(): Promise<CurrentPrice> {
    try {
      return await this.read();
    } catch (error) {
      if (revertName(error) === "StalePrice" && this.chain.deployment.mockFeed) {
        await this.refreshMock();
        return this.read();
      }
      throw error;
    }
  }

  /**
   * Dev/demo only: move the mock gold price (e.g. to show a trade rejected for slippage). With
   * a mirror, the manual price holds for `holdSeconds` before the mirror takes over again.
   */
  async setMockPrice(xauUsdE8: bigint): Promise<CurrentPrice> {
    await this.queue.run(() => this.chain.setMockPrice(xauUsdE8));
    if (this.mirror) this.holdUntilMs = this.nowMs() + this.mirror.holdSeconds * 1000;
    return this.read();
  }

  /**
   * Dev/demo only: undo manual price moves. With a mirror, go straight back to the reference
   * price; without one, back to the price the mock feed was deployed with.
   */
  async resetMockPrice(): Promise<CurrentPrice> {
    const target = this.mirror
      ? (await this.mirror.feed.read()).answer
      : await this.chain.mockFeedInitialAnswer();
    await this.queue.run(() => this.chain.setMockPrice(target));
    this.holdUntilMs = 0;
    return this.read();
  }

  /** Keeps the mock feed fresh and, with a mirror, in step. No-op with a real Chainlink feed. */
  startKeeper(): void {
    if (!this.chain.deployment.mockFeed || this.keeper) return;
    const maxStaleness = BigInt(this.chain.deployment.maxStaleness);
    const freshnessSeconds = Math.min(Number(maxStaleness / 4n), 300);
    const seconds = this.mirror
      ? Math.min(this.mirror.intervalSeconds, freshnessSeconds)
      : freshnessSeconds;
    this.keeper = setInterval(() => {
      void this.tick().catch((error: unknown) => {
        console.error("Mock price keeper failed:", error);
      });
    }, seconds * 1000);
    this.keeper.unref();
  }

  /**
   * One keeper pass: follow the reference feed if there is one, otherwise re-publish the
   * current answer when it is getting old. Public so startup and tests can run a pass directly.
   */
  async tick(): Promise<void> {
    if (!this.chain.deployment.mockFeed) return;
    if (this.mirror && this.nowMs() >= this.holdUntilMs) {
      try {
        if (await this.copyReference(this.mirror)) return;
      } catch (error) {
        // A bad or unreachable reference must never move the price: keep what we have.
        console.error("Price mirror skipped, keeping the current price:", error);
      }
    }
    await this.refreshIfAging(BigInt(this.chain.deployment.maxStaleness));
  }

  stopKeeper(): void {
    if (this.keeper) clearInterval(this.keeper);
    this.keeper = undefined;
  }

  private async read(): Promise<CurrentPrice> {
    const { xauUsdE8, updatedAt } = await this.chain.latestPrice();
    return { xauUsdE8, updatedAt, usdPkrE4: this.usdPkrE4, source: this.source };
  }

  /** Copies the reference price into the mock if it moved enough. Returns whether it did. */
  private async copyReference(mirror: MirrorOptions): Promise<boolean> {
    const [reference, { answer: current }] = await Promise.all([
      mirror.feed.read(),
      this.chain.mockFeedAnswer(),
    ]);
    const gap =
      reference.answer > current ? reference.answer - current : current - reference.answer;
    if (current > 0n && (gap * 10_000n) / current < mirror.minMoveBps) return false;
    await this.queue.run(() => this.chain.setMockPrice(reference.answer));
    return true;
  }

  private async refreshIfAging(maxStaleness: bigint): Promise<void> {
    const [{ updatedAt }, now] = await Promise.all([
      this.chain.mockFeedAnswer(),
      this.chain.latestBlockTimestamp(),
    ]);
    if (now - updatedAt > maxStaleness / 2n) await this.refreshMock();
  }

  private async refreshMock(): Promise<void> {
    await this.queue.run(async () => {
      const { answer } = await this.chain.mockFeedAnswer();
      await this.chain.setMockPrice(answer);
    });
  }
}
