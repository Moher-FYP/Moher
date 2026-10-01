import type { MoharChain } from "../chain/mohar-chain.js";
import { revertName } from "../chain/errors.js";
import type { SerialQueue } from "../lib/queue.js";

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
 * answer before it goes stale — the stand-in for Chainlink's heartbeat.
 */
export class PriceService {
  private keeper: NodeJS.Timeout | undefined;

  constructor(
    private readonly chain: MoharChain,
    private readonly queue: SerialQueue,
    private readonly usdPkrE4: bigint,
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

  /** Dev/demo only: move the mock gold price (e.g. to show a trade rejected for slippage). */
  async setMockPrice(xauUsdE8: bigint): Promise<CurrentPrice> {
    await this.queue.run(() => this.chain.setMockPrice(xauUsdE8));
    return this.read();
  }

  /** Keeps the mock feed fresh. No-op with a real Chainlink feed. */
  startKeeper(): void {
    if (!this.chain.deployment.mockFeed || this.keeper) return;
    const maxStaleness = BigInt(this.chain.deployment.maxStaleness);
    const intervalMs = Math.min(Number(maxStaleness / 4n), 300) * 1000;
    this.keeper = setInterval(() => {
      void this.refreshIfAging(maxStaleness).catch((error: unknown) => {
        console.error("Mock price keeper failed:", error);
      });
    }, intervalMs);
    this.keeper.unref();
  }

  stopKeeper(): void {
    if (this.keeper) clearInterval(this.keeper);
    this.keeper = undefined;
  }

  private async read(): Promise<CurrentPrice> {
    const { xauUsdE8, updatedAt } = await this.chain.latestPrice();
    return { xauUsdE8, updatedAt, usdPkrE4: this.usdPkrE4, source: this.source };
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
