import { createPublicClient, http, parseAbi, type Address } from "viem";

/** A gold price read from the feed the mock mirrors. */
export interface ReferencePrice {
  /** USD per troy ounce, 8 decimals. */
  answer: bigint;
  /** When the reference feed last updated (Unix seconds). */
  updatedAt: bigint;
}

/** Where the mock feed's price comes from on a testnet that has no XAU/USD feed of its own. */
export interface ReferenceFeed {
  read(): Promise<ReferencePrice>;
}

/** Outside this range the value is a decimals or feed mix-up, not a gold price. */
export const REFERENCE_BOUNDS = {
  minE8: 500n * 10n ** 8n,
  maxE8: 50_000n * 10n ** 8n,
} as const;

/** Throws unless the reference price is positive, plausible and recent enough to copy. */
export function checkReference(
  price: ReferencePrice,
  nowSeconds: bigint,
  maxAgeSeconds: bigint,
): ReferencePrice {
  if (price.answer < REFERENCE_BOUNDS.minE8 || price.answer > REFERENCE_BOUNDS.maxE8) {
    throw new Error(`Reference price ${price.answer} is outside the plausible range for gold`);
  }
  if (price.updatedAt + maxAgeSeconds < nowSeconds) {
    throw new Error(`Reference price is older than ${maxAgeSeconds} seconds`);
  }
  return price;
}

const feedAbi = parseAbi([
  "function decimals() view returns (uint8)",
  "function description() view returns (string)",
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
]);

/**
 * Reads a Chainlink XAU/USD feed on another chain (Polygon mainnet for the FYP). Reading is
 * free: no transaction is sent there.
 */
export class ChainlinkReferenceFeed implements ReferenceFeed {
  private readonly client;

  constructor(
    rpcUrl: string,
    private readonly address: Address,
    private readonly maxAgeSeconds: bigint,
  ) {
    this.client = createPublicClient({ transport: http(rpcUrl) });
  }

  /** Confirms the address really is an 8-decimal XAU/USD feed. Returns its description. */
  async verify(): Promise<string> {
    const [decimals, description] = await Promise.all([
      this.client.readContract({ address: this.address, abi: feedAbi, functionName: "decimals" }),
      this.client.readContract({
        address: this.address,
        abi: feedAbi,
        functionName: "description",
      }),
    ]);
    if (decimals !== 8 || !/XAU/i.test(description) || !/USD/i.test(description)) {
      throw new Error(
        `MIRROR_FEED_ADDRESS is "${description}" with ${decimals} decimals, not an 8-decimal XAU/USD feed`,
      );
    }
    return description;
  }

  async read(): Promise<ReferencePrice> {
    const [, answer, , updatedAt] = await this.client.readContract({
      address: this.address,
      abi: feedAbi,
      functionName: "latestRoundData",
    });
    const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
    return checkReference({ answer, updatedAt }, nowSeconds, this.maxAgeSeconds);
  }
}
