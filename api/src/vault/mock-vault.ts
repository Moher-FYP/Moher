import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { encodeAbiParameters, keccak256, zeroHash, type Address, type Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import type { Allocation, Deallocation, ReserveAttestation } from "../chain/mohar-chain.js";
import type { Deployment } from "../chain/deployment.js";

const ALLOCATION_TYPES = {
  Allocation: [
    { name: "wallet", type: "address" },
    { name: "grams", type: "uint256" },
    { name: "allocationRef", type: "bytes32" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

const DEALLOCATION_TYPES = {
  Deallocation: [
    { name: "wallet", type: "address" },
    { name: "grams", type: "uint256" },
    { name: "deallocationRef", type: "bytes32" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

const RESERVE_TYPES = {
  ReserveAttestation: [
    { name: "totalGrams", type: "uint256" },
    { name: "allocationsRoot", type: "bytes32" },
    { name: "asOf", type: "uint64" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

const LEAF_ENCODING = ["bytes32", "address", "uint256"];

/** Merkle leaf id for a wallet's holding. Public so anyone can rebuild a proof request. */
export function holdingRef(wallet: Address): Hex {
  return keccak256(
    encodeAbiParameters([{ type: "string" }, { type: "address" }], ["MOHAR holding", wallet]),
  );
}

export interface ReserveSnapshot {
  totalGrams: bigint;
  root: Hex;
  leaves: [Hex, Address, string][];
}

/**
 * Stand-in for the LBMA custodian. Keeps an allocation book (grams per wallet) and signs
 * EIP-712 receipts with its own key — the key the contracts trust as `vaultSigner`.
 *
 * Accounting rule (docs/contracts.md): an allocation counts from the moment it is signed and is
 * released if the mint fails; a de-allocation is applied only after the burn is confirmed.
 * Honest attestations therefore never show a false shortfall.
 */
export class MockVault {
  private readonly account: PrivateKeyAccount;
  private readonly holdings = new Map<Address, bigint>();
  private lastNonce = 0n;
  private lastAsOf = 0n;

  constructor(
    privateKey: Hex,
    private readonly deployment: Deployment,
  ) {
    this.account = privateKeyToAccount(privateKey);
  }

  get address(): Address {
    return this.account.address;
  }

  // ---------------------------------------------------------------- signing

  signAllocation(allocation: Allocation): Promise<Hex> {
    return this.account.signTypedData({
      domain: this.tokenDomain(),
      types: ALLOCATION_TYPES,
      primaryType: "Allocation",
      message: allocation,
    });
  }

  signDeallocation(deallocation: Deallocation): Promise<Hex> {
    return this.account.signTypedData({
      domain: this.tokenDomain(),
      types: DEALLOCATION_TYPES,
      primaryType: "Deallocation",
      message: deallocation,
    });
  }

  signReserve(attestation: ReserveAttestation): Promise<Hex> {
    return this.account.signTypedData({
      domain: {
        name: "MOHAR Reserve",
        version: "1",
        chainId: this.deployment.chainId,
        verifyingContract: this.deployment.reserveRegistry,
      },
      types: RESERVE_TYPES,
      primaryType: "ReserveAttestation",
      message: attestation,
    });
  }

  // ---------------------------------------------------------------- allocation book

  /** Replace the book, e.g. from on-chain balances at startup. */
  load(holdings: Iterable<readonly [Address, bigint]>, lastNonce: bigint, lastAsOf: bigint): void {
    this.holdings.clear();
    for (const [wallet, grams] of holdings) if (grams > 0n) this.holdings.set(wallet, grams);
    this.lastNonce = lastNonce;
    this.lastAsOf = lastAsOf;
  }

  allocate(wallet: Address, grams: bigint): void {
    this.holdings.set(wallet, (this.holdings.get(wallet) ?? 0n) + grams);
  }

  /** Undo an allocation whose mint failed. */
  releaseAllocation(wallet: Address, grams: bigint): void {
    this.deallocate(wallet, grams);
  }

  deallocate(wallet: Address, grams: bigint): void {
    const remaining = (this.holdings.get(wallet) ?? 0n) - grams;
    if (remaining < 0n) throw new Error(`Vault book would go negative for ${wallet}`);
    if (remaining === 0n) this.holdings.delete(wallet);
    else this.holdings.set(wallet, remaining);
  }

  move(from: Address, to: Address, grams: bigint): void {
    this.deallocate(from, grams);
    this.allocate(to, grams);
  }

  holdingOf(wallet: Address): bigint {
    return this.holdings.get(wallet) ?? 0n;
  }

  snapshot(): ReserveSnapshot {
    const leaves = [...this.holdings.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([wallet, grams]): [Hex, Address, string] => [
        holdingRef(wallet),
        wallet,
        grams.toString(),
      ]);
    const totalGrams = [...this.holdings.values()].reduce((sum, g) => sum + g, 0n);
    const root =
      leaves.length === 0 ? zeroHash : (StandardMerkleTree.of(leaves, LEAF_ENCODING).root as Hex);
    return { totalGrams, root, leaves };
  }

  /** Merkle proof that `wallet` holds its current grams, for ReserveRegistry.verifyAllocation. */
  proof(wallet: Address): { ref: Hex; grams: bigint; proof: Hex[] } | null {
    const { leaves } = this.snapshot();
    if (!leaves.some(([, w]) => w === wallet)) return null;
    const tree = StandardMerkleTree.of(leaves, LEAF_ENCODING);
    for (const [i, [ref, w, grams]] of tree.entries()) {
      if (w === wallet) return { ref, grams: BigInt(grams), proof: tree.getProof(i) as Hex[] };
    }
    return null;
  }

  /** Next attestation of the current book. `now` is chain time in seconds. */
  nextAttestation(now: bigint): ReserveAttestation {
    const { totalGrams, root } = this.snapshot();
    const asOf = now > this.lastAsOf ? now : this.lastAsOf;
    this.lastNonce += 1n;
    this.lastAsOf = asOf;
    return { totalGrams, allocationsRoot: root, asOf, nonce: this.lastNonce };
  }

  private tokenDomain() {
    return {
      name: "MOHAR",
      version: "1",
      chainId: this.deployment.chainId,
      verifyingContract: this.deployment.moharToken,
    } as const;
  }
}
