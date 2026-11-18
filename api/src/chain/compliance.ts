import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  toHex,
  type Address,
  type Hex,
  type PrivateKeyAccount,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { anvil, polygonAmoy } from "viem/chains";
import { walletRegistryAbi } from "./abis.js";
import type { Deployment } from "./deployment.js";

/** keccak256("COMPLIANCE_ROLE"), as in WalletRegistry.sol. */
export const COMPLIANCE_ROLE = keccak256(toHex("COMPLIANCE_ROLE"));

/**
 * The compliance key: freezes and unfreezes customer wallets, and nothing else. Kept apart from
 * the relayer (which already settles every trade, registers wallets and publishes the reserve)
 * so one stolen key cannot both move gold and lock customers out, or unlock a wallet compliance
 * froze. It has its own nonce, so it does not go through the relayer's queue; its own writes
 * are serialised here.
 */
export class ComplianceSigner {
  readonly account: PrivateKeyAccount;
  private readonly publicClient;
  private readonly walletClient;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly deployment: Deployment,
    rpcUrl: string,
    privateKey: Hex,
  ) {
    this.account = privateKeyToAccount(privateKey);
    const chain = deployment.chainId === polygonAmoy.id ? polygonAmoy : anvil;
    const transport = http(rpcUrl);
    this.publicClient = createPublicClient({ chain, transport });
    this.walletClient = createWalletClient({ chain, transport, account: this.account });
  }

  get address(): Address {
    return this.account.address;
  }

  /** True once the admin has granted this key COMPLIANCE_ROLE on the WalletRegistry. */
  hasRole(): Promise<boolean> {
    return this.publicClient.readContract({
      address: this.deployment.walletRegistry,
      abi: walletRegistryAbi,
      functionName: "hasRole",
      args: [COMPLIANCE_ROLE, this.account.address],
    });
  }

  /**
   * Freezes a wallet. The reason code on-chain is a hash of the freeze request's id, so the
   * chain links to MOHAR's record without holding any reason text or personal data.
   */
  freeze(wallet: Address, requestId: string): Promise<Hex> {
    return this.write("freezeWallet", [wallet, keccak256(toHex(requestId))]);
  }

  unfreeze(wallet: Address): Promise<Hex> {
    return this.write("unfreezeWallet", [wallet]);
  }

  /**
   * Writes data on-chain in a transaction to its own address (no contract, no value): the
   * audit-log anchor (portal/anchor.ts). Any account can do this; it needs no role.
   */
  anchor(data: Hex): Promise<Hex> {
    const run = async () => {
      const hash = await this.walletClient.sendTransaction({
        account: this.account,
        to: this.account.address,
        value: 0n,
        data,
      });
      const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(`Transaction ${hash} reverted on-chain`);
      return hash;
    };
    const next = this.tail.then(run, run);
    this.tail = next.catch(() => undefined);
    return next;
  }

  /** The data a transaction carried, as the chain has it; undefined if it is not found. */
  async transactionData(
    hash: Hex,
  ): Promise<{ from: Address; to: Address | null; input: Hex } | undefined> {
    try {
      const tx = await this.publicClient.getTransaction({ hash });
      return { from: tx.from, to: tx.to, input: tx.input };
    } catch {
      return undefined;
    }
  }

  private write(
    functionName: "freezeWallet" | "unfreezeWallet",
    args: readonly [Address, Hex] | readonly [Address],
  ): Promise<Hex> {
    const run = async () => {
      const { request } = await this.publicClient.simulateContract({
        account: this.account,
        address: this.deployment.walletRegistry,
        abi: walletRegistryAbi,
        functionName,
        args: args as never,
      });
      const hash = await this.walletClient.writeContract(request);
      const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(`Transaction ${hash} reverted on-chain`);
      return hash;
    };
    const next = this.tail.then(run, run);
    this.tail = next.catch(() => undefined);
    return next;
  }
}
