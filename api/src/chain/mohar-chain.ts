import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Address,
  type Chain,
  type Hex,
  type PrivateKeyAccount,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { anvil, polygonAmoy } from "viem/chains";
import {
  mockV3AggregatorAbi,
  moharTokenAbi,
  reserveRegistryAbi,
  walletRegistryAbi,
} from "./abis.js";
import type { Deployment } from "./deployment.js";
import { revertName } from "./errors.js";

export interface Allocation {
  wallet: Address;
  grams: bigint;
  allocationRef: Hex;
  deadline: bigint;
}

export interface Deallocation {
  wallet: Address;
  grams: bigint;
  deallocationRef: Hex;
  deadline: bigint;
}

export interface ReserveAttestation {
  totalGrams: bigint;
  allocationsRoot: Hex;
  asOf: bigint;
  nonce: bigint;
}

export interface PublishedReserve {
  attestation: ReserveAttestation;
  tokenSupplyAtPublish: bigint;
  publishedAt: bigint;
}

export interface TxResult {
  hash: Hex;
  blockNumber: bigint;
}

type OnSubmitted = (hash: Hex) => void;

const EXPLORERS: Record<number, string> = {
  80002: "https://amoy.polygonscan.com",
};

function chainFor(chainId: number, rpcUrl: string): Chain {
  if (chainId === anvil.id) return anvil;
  if (chainId === polygonAmoy.id) return polygonAmoy;
  return defineChain({
    id: chainId,
    name: `chain-${chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
}

/**
 * Everything the API does on-chain. Reads are safe to call concurrently; writes must be
 * serialised by the caller (see SerialQueue) because they share the relayer's nonce.
 */
export class MoharChain {
  readonly deployment: Deployment;
  readonly relayer: PrivateKeyAccount;
  private readonly chain: Chain;
  private readonly publicClient;
  private readonly walletClient;

  constructor(deployment: Deployment, rpcUrl: string, relayerPrivateKey: Hex) {
    this.deployment = deployment;
    this.chain = chainFor(deployment.chainId, rpcUrl);
    this.relayer = privateKeyToAccount(relayerPrivateKey);
    const transport = http(rpcUrl);
    this.publicClient = createPublicClient({ chain: this.chain, transport });
    this.walletClient = createWalletClient({
      chain: this.chain,
      transport,
      account: this.relayer,
    });
  }

  get chainId(): number {
    return this.deployment.chainId;
  }

  // ---------------------------------------------------------------- reads

  getChainId(): Promise<number> {
    return this.publicClient.getChainId();
  }

  getBlockNumber(): Promise<bigint> {
    return this.publicClient.getBlockNumber();
  }

  /** Hash of block 1 — changes whenever a local Anvil chain is restarted from scratch. */
  async chainMarker(): Promise<string> {
    const block = await this.publicClient.getBlock({ blockNumber: 1n });
    return block.hash;
  }

  /** XAU/USD per troy ounce (8 decimals). Reverts on-chain if the feed is stale or invalid. */
  async latestPrice(): Promise<{ xauUsdE8: bigint; updatedAt: bigint }> {
    const [xauUsdE8, updatedAt] = await this.publicClient.readContract({
      address: this.deployment.moharToken,
      abi: moharTokenAbi,
      functionName: "latestPrice",
    });
    return { xauUsdE8, updatedAt };
  }

  balanceOf(wallet: Address): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.deployment.moharToken,
      abi: moharTokenAbi,
      functionName: "balanceOf",
      args: [wallet],
    });
  }

  totalSupply(): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.deployment.moharToken,
      abi: moharTokenAbi,
      functionName: "totalSupply",
    });
  }

  mintingPaused(): Promise<boolean> {
    return this.publicClient.readContract({
      address: this.deployment.moharToken,
      abi: moharTokenAbi,
      functionName: "mintingPaused",
    });
  }

  isWalletActive(wallet: Address): Promise<boolean> {
    return this.publicClient.readContract({
      address: this.deployment.walletRegistry,
      abi: walletRegistryAbi,
      functionName: "isActive",
      args: [wallet],
    });
  }

  async latestReserve(): Promise<PublishedReserve | null> {
    try {
      const latest = await this.publicClient.readContract({
        address: this.deployment.reserveRegistry,
        abi: reserveRegistryAbi,
        functionName: "latest",
      });
      return latest as PublishedReserve;
    } catch (error) {
      if (revertName(error) === "NoAttestation") return null;
      throw error;
    }
  }

  verifyAllocation(ref: Hex, wallet: Address, grams: bigint, proof: Hex[]): Promise<boolean> {
    return this.publicClient.readContract({
      address: this.deployment.reserveRegistry,
      abi: reserveRegistryAbi,
      functionName: "verifyAllocation",
      args: [ref, wallet, grams, proof],
    });
  }

  async hasCode(address: Address): Promise<boolean> {
    const code = await this.publicClient.getCode({ address });
    return code !== undefined && code !== "0x";
  }

  isFullyBacked(): Promise<boolean> {
    return this.publicClient.readContract({
      address: this.deployment.reserveRegistry,
      abi: reserveRegistryAbi,
      functionName: "isFullyBacked",
    });
  }

  // ---------------------------------------------------------------- writes (serialise!)

  async registerWallet(
    wallet: Address,
    partnerId: Hex,
    kycAttestationHash: Hex,
  ): Promise<TxResult> {
    const { request } = await this.publicClient.simulateContract({
      account: this.relayer,
      address: this.deployment.walletRegistry,
      abi: walletRegistryAbi,
      functionName: "registerWallet",
      args: [wallet, partnerId, kycAttestationHash],
    });
    return this.sendAndWait(this.walletClient.writeContract(request));
  }

  async mint(
    allocation: Allocation,
    quotedPrice: bigint,
    vaultSignature: Hex,
    onSubmitted?: OnSubmitted,
  ): Promise<TxResult> {
    const { request } = await this.publicClient.simulateContract({
      account: this.relayer,
      address: this.deployment.moharToken,
      abi: moharTokenAbi,
      functionName: "mint",
      args: [allocation, quotedPrice, vaultSignature],
    });
    return this.sendAndWait(this.walletClient.writeContract(request), onSubmitted);
  }

  async burn(
    deallocation: Deallocation,
    quotedPrice: bigint,
    vaultSignature: Hex,
    onSubmitted?: OnSubmitted,
  ): Promise<TxResult> {
    const { request } = await this.publicClient.simulateContract({
      account: this.relayer,
      address: this.deployment.moharToken,
      abi: moharTokenAbi,
      functionName: "burn",
      args: [deallocation, quotedPrice, vaultSignature],
    });
    return this.sendAndWait(this.walletClient.writeContract(request), onSubmitted);
  }

  async operatorTransfer(
    from: Address,
    to: Address,
    grams: bigint,
    onSubmitted?: OnSubmitted,
  ): Promise<TxResult> {
    const { request } = await this.publicClient.simulateContract({
      account: this.relayer,
      address: this.deployment.moharToken,
      abi: moharTokenAbi,
      functionName: "operatorTransfer",
      args: [from, to, grams],
    });
    return this.sendAndWait(this.walletClient.writeContract(request), onSubmitted);
  }

  async publishReserve(attestation: ReserveAttestation, vaultSignature: Hex): Promise<TxResult> {
    const { request } = await this.publicClient.simulateContract({
      account: this.relayer,
      address: this.deployment.reserveRegistry,
      abi: reserveRegistryAbi,
      functionName: "publish",
      args: [attestation, vaultSignature],
    });
    return this.sendAndWait(this.walletClient.writeContract(request));
  }

  /** Sets the mock XAU/USD answer. Only valid when the deployment uses MockV3Aggregator. */
  async setMockPrice(xauUsdE8: bigint): Promise<TxResult> {
    if (!this.deployment.mockFeed) throw new Error("The deployment uses a real price feed");
    const { request } = await this.publicClient.simulateContract({
      account: this.relayer,
      address: this.deployment.xauUsdFeed,
      abi: mockV3AggregatorAbi,
      functionName: "updateAnswer",
      args: [xauUsdE8],
    });
    return this.sendAndWait(this.walletClient.writeContract(request));
  }

  /** Current raw answer of the mock feed, without the staleness check. */
  async mockFeedAnswer(): Promise<{ answer: bigint; updatedAt: bigint }> {
    const [, answer, , updatedAt] = await this.publicClient.readContract({
      address: this.deployment.xauUsdFeed,
      abi: mockV3AggregatorAbi,
      functionName: "latestRoundData",
    });
    return { answer, updatedAt };
  }

  async latestBlockTimestamp(): Promise<bigint> {
    const block = await this.publicClient.getBlock();
    return block.timestamp;
  }

  // ---------------------------------------------------------------- links

  explorerTxUrl(hash: Hex): string | undefined {
    const base = EXPLORERS[this.chainId];
    return base ? `${base}/tx/${hash}` : undefined;
  }

  explorerAddressUrl(address: Address): string | undefined {
    const base = EXPLORERS[this.chainId];
    return base ? `${base}/address/${address}` : undefined;
  }

  // ---------------------------------------------------------------- internal

  private async sendAndWait(sent: Promise<Hex>, onSubmitted?: OnSubmitted): Promise<TxResult> {
    const hash = await sent;
    onSubmitted?.(hash);
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new Error(`Transaction ${hash} reverted on-chain`);
    }
    return { hash, blockNumber: receipt.blockNumber };
  }
}
