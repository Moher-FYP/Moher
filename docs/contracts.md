# Contracts specification

Status: **implemented and tested** (`contracts/src/`, 69 Foundry tests including the H2 fuzz
suite). Source of truth: `contracts/src/interfaces/` and `contracts/src/libraries/MoharTypes.sol`.
If this document and the code disagree, fix one of them in the same PR.

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
4. In the same transaction the token, in this order:
   - checks `SETTLEMENT_ROLE`, minting not paused, `grams > 0`;
   - checks `block.timestamp <= deadline` and `allocationRef` not used before;
   - recovers the EIP-712 signer and requires it to equal `vaultSigner()`;
   - reads the oracle; reverts on `answer <= 0` or `updatedAt` older than `maxStaleness`;
   - reverts if `deviationBps(quotedPrice, oraclePrice) > maxDeviationBps` (gharar control,
     FYP-1 §3.4.4);
   - marks `allocationRef` used and mints; `_update` requires the wallet to be active in the
     registry;
   - emits `Minted(wallet, grams, oraclePrice, quotedPrice, allocationRef)`.

If any check fails the whole transaction reverts: no tokens move and the vault reference is not
consumed, so the API can re-quote and retry with the same allocation.

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
  pauses minting on the token. Burns stay open. Unpausing is a manual admin action after
  reconciliation — a later healthy attestation does **not** auto-unpause.
- `isFullyBacked()` answers "did the latest attestation cover the supply at the moment it was
  published?" Mints after that moment are covered by their own vault signatures and show up in
  the next attestation.
- **Vault accounting rule** (for the mock vault in the API): count an allocation from the moment
  you sign it; release a de-allocation only after the burn is confirmed. Then an honest
  attestation can never show a false shortfall.
- Public views: `latest()`, `isFullyBacked()`, `verifyAllocation(ref, wallet, grams, proof)`.
  The demo's "Verify backing" screen reads these directly from the chain.

## Tests and the H2 hypothesis

```bash
pnpm contracts:test                                            # all 69 tests
cd contracts && forge test --match-contract H2SlippageTest -vv # the H2 evidence only
```

`test/H2Slippage.t.sol` is the Chapter 5 evidence for **H2 (slippage elimination)**. Each fuzz
test runs 1,000 randomized trades (up to one tonne) while the oracle moves anywhere within ±5%
of the quote, and asserts:

- **P1** — every executed mint/burn records an execution price exactly equal to the oracle
  price in that block (zero deviation);
- **P2** — every trade whose quote-to-oracle move exceeds 0.50% reverts and moves nothing.

A third fuzz test checks that total supply always equals vault-signed allocations minus
de-allocations. Other suites cover access control, signature forgery and tampering, replay
(same ref, other chain, allocation-as-deallocation, token-domain signature on the reserve),
expiry, stale and invalid oracle answers, frozen wallets, deactivated partners, pause
behaviour, key rotation and Merkle proofs.

## Deployment

`contracts/script/Deploy.s.sol` deploys everything, grants the roles in the table above,
registers the `demo-bank` partner, and writes addresses to `contracts/deployments/<chainId>.json`,
which the API reads.

```bash
pnpm chain                     # terminal 1
pnpm contracts:deploy:local    # terminal 2 — no .env needed on Anvil
```

On Anvil the script uses account #0 as admin, #1 as relayer and #2 as vault signer. Anvil
restarts from an empty chain, so re-run the deploy after every `pnpm chain`; addresses are
deterministic and match the committed `deployments/31337.json`.

For Amoy, fill in `contracts/.env` and run
`source .env && forge script script/Deploy.s.sol --rpc-url amoy --broadcast`. The script refuses
to use the public Anvil key on any other network.

Changing the mock price for a demo (e.g. to show a trade rejected for moving > 0.50%):

```bash
cast send <xauUsdFeed> "updateAnswer(int256)" 470000000000 --rpc-url http://127.0.0.1:8545 --private-key <anvil key #0>
```

## Decisions

- **Oracle staleness:** 1 hour by default (`MAX_STALENESS_SECONDS`). Chainlink's XAU/USD
  heartbeat is longer on some networks; raise it on Amoy if using the real feed.
- **Auto-unpause after a shortfall:** no. Resuming issuance after a reserve problem is a
  governance decision.
- **Max deviation:** 50 bps default, admin-configurable within 1–1,000 bps.

## Open questions

- [ ] Is the Chainlink XAU/USD feed deployed on Polygon Amoy? If yes, set
      `XAU_USD_FEED_ADDRESS` before deploying; if not, the script deploys the mock and the
      thesis should say so.
