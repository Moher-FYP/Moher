# Contracts specification

Status: **draft interfaces** (scaffold PR). Implementations follow in the next PRs and must
match these interfaces. Source of truth: `contracts/src/interfaces/` and
`contracts/src/libraries/MoharTypes.sol`. If this document and the code disagree, fix one of
them in the same PR.

## Contracts

| Contract           | Purpose                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| `MoharToken`       | ERC-20 gold token. 1 MOHAR = 1 gram, 8 decimals. Mint/burn against vault signatures and oracle.  |
| `WalletRegistry`   | Which custodial wallets may hold MOHAR and which partner onboarded them. Freeze for AML.         |
| `ReserveRegistry`  | Proof-of-Reserve: vault-signed totals + Merkle root of allocations; pauses minting on shortfall. |
| `MockV3Aggregator` | Local/testnet stand-in for the Chainlink XAU/USD feed.                                           |

Network: Polygon Amoy testnet (chain id `80002`) for the FYP; local development on Anvil
(chain id `31337`). Solidity `0.8.24`, OpenZeppelin Contracts `5.4.0`.

## Units

| Quantity  | Representation                                           |
| --------- | -------------------------------------------------------- |
| Gold      | grams × 10⁸ (`1e8` = 1 g, smallest unit 0.00000001 g)    |
| Price     | XAU/USD per **troy ounce** × 10⁸ (Chainlink feed format) |
| Deviation | basis points; default max 50 bps (0.50%)                 |
| Ounce     | 31.1035 g (`GRAMS_PER_TROY_OUNCE_E4 = 311035`)           |

PKR never appears on-chain. PKR/USD conversion, fees and fiat settlement happen off-chain in
the API and at the partner institution.

## Roles

| Role                    | Contract          | Held by                        | Can                                          |
| ----------------------- | ----------------- | ------------------------------ | -------------------------------------------- |
| `DEFAULT_ADMIN_ROLE`    | all               | MOHAR admin (multisig in prod) | Configure, grant/revoke roles                |
| `SETTLEMENT_ROLE`       | `MoharToken`      | API relayer                    | `mint`, `burn`                               |
| `OPERATOR_ROLE`         | `MoharToken`      | API relayer                    | `operatorTransfer` between custodial wallets |
| `PAUSER_ROLE`           | `MoharToken`      | MOHAR admin                    | `pauseMinting`, `unpauseMinting`             |
| `RESERVE_GUARDIAN_ROLE` | `MoharToken`      | `ReserveRegistry`              | `pauseMinting` on reserve shortfall          |
| `PARTNER_ADMIN_ROLE`    | `WalletRegistry`  | MOHAR admin                    | Register / deactivate partner institutions   |
| `REGISTRAR_ROLE`        | `WalletRegistry`  | API relayer                    | Register customer wallets                    |
| `COMPLIANCE_ROLE`       | `WalletRegistry`  | MOHAR compliance               | Freeze / unfreeze wallets                    |
| `PUBLISHER_ROLE`        | `ReserveRegistry` | API relayer                    | Publish vault-signed reserve attestations    |

Keys in the FYP: **admin**, **relayer** (one EOA, holds all relayer roles) and **vault signer**
(used only by the mock vault service). The FYP-1 report specifies 2-of-3 multisig for the
attestor key and 3-of-5 for admin; in the prototype this is documented as a production control.

## Wallet rules

| Action           | Requirement                                                                    |
| ---------------- | ------------------------------------------------------------------------------ |
| Mint to wallet   | wallet `Active` in `WalletRegistry` and its partner active; minting not paused |
| Burn from wallet | wallet `Active` (burns are **not** blocked by a reserve pause)                 |
| Transfer         | both sender and recipient `Active`                                             |
| Frozen wallet    | cannot mint, burn or transfer until unfrozen                                   |

KYC/AML of customers is the partner institution's responsibility. The registry stores only
`kycAttestationHash = keccak256(partner KYC reference)` — no personal data on-chain
(FYP-1 §3.5.3, data minimisation).

## Mint (and burn) sequence

1. API builds a quote: reads XAU/USD (on-chain feed) and PKR/USD (off-chain), computes grams,
   locks the quote for 60 s.
2. Mock vault signs an EIP-712 `Allocation{wallet, grams, allocationRef, deadline}`.
3. Relayer calls `mint(allocation, quotedPrice, vaultSignature)`.
4. In the same transaction the token:
   - checks `SETTLEMENT_ROLE`, minting not paused, `grams > 0`;
   - checks wallet is active in the registry;
   - checks `block.timestamp <= deadline` and `allocationRef` not used before;
   - recovers the EIP-712 signer and requires it to equal `vaultSigner()`;
   - reads the oracle; reverts on `answer <= 0` or `updatedAt` older than `maxStaleness`;
   - reverts if `deviationBps(quotedPrice, oraclePrice) > maxDeviationBps` (gharar control,
     FYP-1 §3.4.4);
   - marks `allocationRef` used, mints, emits `Minted(wallet, grams, oraclePrice, quotedPrice,
allocationRef)`.

Burn is identical with `Deallocation` and `Burned`. Constructive possession (qabd) happens in
one block: vault receipt verified and tokens issued atomically (FYP-1 §3.4.1).

> Note for Chapter 3 revision: the FYP-1 report says the contract "calls the Vault Attestation
> API". Contracts cannot make HTTP calls; the vault signs off-chain and the contract verifies
> the signature on-chain. The atomicity argument is unchanged.

## EIP-712

| Signed by | Domain name     | Version | Verifying contract | Type string                                                                                |
| --------- | --------------- | ------- | ------------------ | ------------------------------------------------------------------------------------------ |
| Vault     | `MOHAR`         | `1`     | `MoharToken`       | `Allocation(address wallet,uint256 grams,bytes32 allocationRef,uint256 deadline)`          |
| Vault     | `MOHAR`         | `1`     | `MoharToken`       | `Deallocation(address wallet,uint256 grams,bytes32 deallocationRef,uint256 deadline)`      |
| Vault     | `MOHAR Reserve` | `1`     | `ReserveRegistry`  | `ReserveAttestation(uint256 totalGrams,bytes32 allocationsRoot,uint64 asOf,uint256 nonce)` |

`chainId` is part of every domain, so a signature made for Anvil is invalid on Amoy and
vice versa. The API signer (viem `signTypedData`) must use these exact strings; a unit test in
`contracts/test` pins them.

## Proof of Reserve

- Vault builds a Merkle tree of allocations with the OpenZeppelin `merkle-tree` JS library,
  leaf encoding `["bytes32","address","uint256"]` = `(allocationRef, wallet, grams)`.
- Vault signs `ReserveAttestation{totalGrams, allocationsRoot, asOf, nonce}`; relayer calls
  `publish`. Nonce strictly increasing; `asOf` never goes backwards.
- On publish, if `totalGrams < token.totalSupply()` the registry emits `ReserveShortfall` and
  pauses minting on the token. Unpausing is a manual admin action after reconciliation.
- Public views: `latest()`, `isFullyBacked()`, `verifyAllocation(ref, wallet, grams, proof)`.
  The demo's "Verify backing" screen reads these directly from the chain.

## Open questions (resolve before implementation)

- [ ] Is the Chainlink XAU/USD feed deployed on Amoy? If not, deploy `MockV3Aggregator` and run
      a price-updater script. Document the choice in the thesis.
- [ ] `maxStaleness`: Chainlink XAU/USD heartbeat on Polygon is typically long; pick a value
      that suits the mock updater (proposal: 1 hour on testnet).
- [ ] Should reserve-triggered pauses auto-unpause when a later attestation is sufficient?
      Current proposal: no, manual unpause only.
