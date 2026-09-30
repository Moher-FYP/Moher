# MOHAR API — how it works and how to try it

The API is what a partner bank talks to (through `@mohar/sdk`). It prices gold, runs the mock
vault, sends transactions to the contracts and publishes Proof-of-Reserve. The contract of
record is `docs/openapi.yaml`; this page explains the moving parts.

## Run it

```bash
pnpm chain                      # terminal 1: local blockchain
pnpm contracts:deploy:local     # terminal 2: deploy (again after every chain restart)
pnpm --filter @mohar/sdk build
pnpm --filter @mohar/api dev    # terminal 2 (or 3): API on http://localhost:4000
```

No `.env` is needed locally. If the API refuses to start, its message says what is missing
(chain not running, contracts not deployed, wrong keys).

## Try the whole flow with curl

```bash
K="Authorization: Bearer mk_test_local"
J="Content-Type: application/json"

# 1. The bank registers a customer after its own KYC
curl -s -X POST localhost:4000/v1/wallets -H "$K" -H "$J" -H "Idempotency-Key: wallet-hassan" \
  -d '{"externalCustomerId":"hassan-001","kyc":{"reference":"HBL-KYC-001","level":"standard","verifiedAt":"2026-10-01T00:00:00Z"}}'
# → {"id":"wal_…", "address":"0x…", "status":"active", …}   (use the id below as $W)

# 2. Quote PKR 25,000 of gold (price locked for 60 s)
curl -s -X POST localhost:4000/v1/quotes -H "$K" -H "$J" \
  -d '{"walletId":"'$W'","side":"buy","amountPkr":"25000.00"}'

# 3. Execute it (returns 202 + a pending transaction)
curl -s -X POST localhost:4000/v1/mints -H "$K" -H "$J" -H "Idempotency-Key: order-1" \
  -d '{"quoteId":"qt_…"}'

# 4. Check the result, balance and reserve
curl -s localhost:4000/v1/transactions/txn_… -H "$K"
curl -s localhost:4000/v1/wallets/$W/balance -H "$K"
curl -s localhost:4000/v1/reserve
curl -s localhost:4000/v1/wallets/$W/reserve-proof -H "$K"
```

Demo trick — show the slippage protection (H2 / gharar control): create a buy quote, then move
the mock gold price by 1% before executing it. The mint fails with `price_moved` and nothing
moves on-chain.

```bash
curl -s -X POST localhost:4000/dev/price -H "$K" -H "$J" -d '{"xauUsd":"4662.16"}'
```

`/dev/*` routes exist only on a local chain with the mock price feed.

## What happens inside

```
POST /v1/mints ─▶ checks (quote valid, wallet active, minting not paused) ─▶ 202 pending
                   │
                   ▼  relayer queue (one transaction at a time)
   mock vault allocates grams + signs EIP-712 Allocation
   relayer calls MoharToken.mint(allocation, quotedPrice, signature)
      └─ contract re-reads the oracle; reverts if price moved > 0.50%
   transaction → submitted → confirmed   (or failed, with a spec error code)
   vault signs a new reserve attestation → ReserveRegistry.publish
   signed webhook → partner
```

| Part        | File                         | Notes                                                                                                                                                                             |
| ----------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pricing     | `src/domain/pricing.ts`      | bigint only. Buy: customer pays gold value + FX margin (0.25%). Sell: receives value − margin. Platform fee (0.50%) is billed to the partner. Rounding favours the reserve.       |
| Oracle      | `src/services/price.ts`      | Reads `MoharToken.latestPrice()`, so the API applies the same staleness rule as the contract. A keeper refreshes the mock feed like Chainlink's heartbeat.                        |
| Mock vault  | `src/vault/mock-vault.ts`    | Allocation book per wallet, EIP-712 signing, Merkle tree (OpenZeppelin `merkle-tree`). Counts an allocation when it signs; releases a de-allocation only after the burn confirms. |
| Settlement  | `src/services/settlement.ts` | Async worker on a serial queue (single relayer nonce). Publishes the reserve after every confirmed trade.                                                                         |
| Chain       | `src/chain/mohar-chain.ts`   | viem. ABIs in `abis.ts` are generated from Foundry output — `pnpm --filter @mohar/api abi`.                                                                                       |
| Idempotency | `src/http/idempotency.ts`    | Same key + body replays the response; a different body is a 409.                                                                                                                  |
| Store       | `src/store/store.ts`         | JSON file in `api/.data/`, reset automatically when the local chain restarts. Swap for Postgres before a real deployment.                                                         |
| Webhooks    | `src/services/webhooks.ts`   | Signed with the SDK's own helper; 3 attempts.                                                                                                                                     |

Custodial wallets are derived from `WALLET_MNEMONIC` (`m/44'/60'/1'/0/i`); customers never hold
keys or gas.

## Tests

```bash
pnpm --filter @mohar/api test    # unit: pricing, HTTP, auth, idempotency
pnpm test:e2e                    # full flow on a throwaway Anvil chain (needs Foundry)
```

The end-to-end test is the demo script in code: register → buy PKR 25,000 → webhook verified →
reserve fully backed and provable per wallet → transfer → sell → oversell refused → 1% price
jump rejected with `price_moved`.
