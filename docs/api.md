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

`/dev/*` routes exist only on a local chain with the mock price feed (or where
`ENABLE_DEV_ROUTES=true`).

### Real gold price on a testnet

Amoy may have no XAU/USD feed. With `MIRROR_RPC_URL` and `MIRROR_FEED_ADDRESS` set, the price
keeper reads Chainlink's XAU/USD feed on Polygon mainnet (free) and copies it into the mock
whenever the two differ by `MIRROR_MIN_MOVE_BPS` (default 0.20%). It never copies a value that
is zero, implausible for gold or older than four days, and after a manual `/dev/price` move it
waits `MIRROR_HOLD_SECONDS` before taking over again, so the slippage demo still works.

`POST /dev/price/reset` undoes a manual move: back to the mirrored market price, or, without a
mirror, to the price the mock feed was deployed with. The demo bank's "Reset price" button
calls it.

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

| Part            | File                         | Notes                                                                                                                                                                                                                                                   |
| --------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pricing         | `src/domain/pricing.ts`      | bigint only. Buy: customer pays gold value + FX margin (0.25%). Sell: receives value − margin. Platform fee (0.50%) is billed to the partner. Rounding favours the reserve.                                                                             |
| Oracle          | `src/services/price.ts`      | Reads `MoharToken.latestPrice()`, so the API applies the same staleness rule as the contract. A keeper refreshes the mock feed like Chainlink's heartbeat and can mirror a real feed into it.                                                           |
| Mock vault      | `src/vault/mock-vault.ts`    | Allocation book per wallet, EIP-712 signing, Merkle tree (OpenZeppelin `merkle-tree`). Counts an allocation when it signs; releases a de-allocation only after the burn confirms.                                                                       |
| Settlement      | `src/services/settlement.ts` | Async worker on a serial queue (single relayer nonce). Publishes the reserve after every confirmed trade.                                                                                                                                               |
| Chain           | `src/chain/mohar-chain.ts`   | viem. ABIs in `abis.ts` are generated from Foundry output — `pnpm --filter @mohar/api abi`.                                                                                                                                                             |
| Idempotency     | `src/http/idempotency.ts`    | Same key + body replays the response; a different body is a 409.                                                                                                                                                                                        |
| Quotes          | `src/http/routes.ts`         | One quote settles once. `claimQuote` re-checks the quote and marks it used with no `await` in between, so two requests arriving together cannot both execute it; the second gets a 409.                                                                 |
| Secrets         | `src/secrets.ts`             | The repo's default API key, webhook secret and operator key are public, so start-up refuses them (and anything short or shared) on every chain but local Anvil. Each partner signs with its own webhook secret.                                         |
| KYC fingerprint | `src/domain/kyc.ts`          | What goes on-chain with a wallet is an HMAC of the partner's KYC reference under `KYC_HASH_SECRET`, not a plain hash, so it cannot be reversed by guessing the reference.                                                                               |
| KYC limits      | `src/domain/kyc-limits.ts`   | Money into a wallet (a purchase, or gold sent to it) over its KYC level's limits, per trade, 24 hours, 30 days or the most it may hold, is refused with 422 `limit_exceeded`, checked again inside the claim. See `docs/kyc-limits.md`.                 |
| Price controls  | `src/http/routes.ts`         | `/dev/price` needs the operator key (`DEV_API_KEY`), never a partner key, and a manual price must stay within `DEV_PRICE_BAND_BPS` of the reference price.                                                                                              |
| Limits          | `src/http/rate-limit.ts`     | Per partner: requests per minute, and a smaller allowance of new wallets per hour (each costs gas). Over the limit is a 429 with `Retry-After`.                                                                                                         |
| Reserve proofs  | `src/services/settlement.ts` | Combined: one proof is published after the trades already waiting have settled, and at most once per `RESERVE_PUBLISH_INTERVAL_SECONDS` (default 0). Measured on Anvil: 331,235 gas for a purchase on its own, 154,491 per purchase in a burst of five. |
| Recovery        | `src/services/settlement.ts` | On start, `recover()` settles trades the last run left unfinished: never sent → failed; sent → as the chain says; no receipt yet → left for the next start.                                                                                             |
| Store           | `src/store/store.ts`         | JSON file in `api/.data/`, reset automatically when the local chain restarts. Swap for Postgres before a real deployment.                                                                                                                               |
| Webhooks        | `src/services/webhooks.ts`   | Signed with the SDK's own helper. Failed deliveries are saved and retried for 3 days (1 min, 5 min, 30 min, 2 h, 6 h, 12 h, then daily, with jitter), also after a restart; recorded for the portal's delivery log.                                     |

Custodial wallets are derived from `WALLET_MNEMONIC` (`m/44'/60'/1'/0/i`); customers never hold
keys or gas.

## Partner portal routes

`/portal/v1/*` serve the partner portal: a partner's own staff, signed in as people, not
servers. They are described in `docs/portal-openapi.yaml` and live in `src/portal/`.

| Part            | Where                        | What it does                                                                                                                                                                                                                                                                                                                |
| --------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Passwords       | `src/portal/passwords.ts`    | Argon2id (19 MiB, 2 passes, 1 thread). At least 12 characters, no symbol rules, refused if on a list of 46,146 common passwords (`api/data/`).                                                                                                                                                                              |
| One-time codes  | `src/portal/totp.ts`         | RFC 6238, 6 digits, 30 s, one step of drift. Each code works once. Secrets sealed with AES-256-GCM under `PORTAL_SECRET_KEY` (`sealed.ts`).                                                                                                                                                                                 |
| Sessions        | `src/portal/auth.ts`         | Random 256-bit token in an `HttpOnly`, `SameSite=Strict` cookie; only its SHA-256 is stored. Ends after 15 min idle, 8 h in all, or sign-out.                                                                                                                                                                               |
| Wrong attempts  | `src/portal/auth.ts`         | From the 5th failure each try waits longer (1 s doubling, to 15 min, answered 429); the 20th disables the account. Also 30 attempts per IP per 15 min.                                                                                                                                                                      |
| Changes         | `src/portal/auth.ts`         | Every POST, PUT and DELETE needs an `Origin` in `PORTAL_ORIGINS`.                                                                                                                                                                                                                                                           |
| Partner scoping | `src/portal/routes.ts`       | The partner comes from the session. Another partner's wallet or transaction is a 404, as if it did not exist.                                                                                                                                                                                                               |
| API keys        | `src/portal/keys.ts`         | Made by developers in the portal: 256 random bits, shown once, stored as SHA-256. Revoked keys are refused from the next request. Keys in `PARTNER_API_KEYS` keep working and are listed by prefix only.                                                                                                                    |
| Webhooks        | `src/lib/safe-post.ts`       | Every delivery and attempt is recorded and can be resent with the same event id. URLs must be https and public; every address a host resolves to is checked inside the connection's own lookup (OWASP SSRF Prevention). No redirects, 15 s timeout. `WEBHOOK_ALLOW_LOCALHOST` lets the demo apps on localhost receive them. |
| Freezes         | `src/chain/compliance.ts`    | A partner's compliance user asks; a MOHAR operator approves; the compliance key (`COMPLIANCE_PRIVATE_KEY`, freeze and unfreeze only) sends it. The reason stays off-chain; the chain gets the hash of the request id.                                                                                                       |
| Log anchors     | `src/portal/anchor.ts`       | Once a day (`AUDIT_ANCHOR_HOURS`) and on demand, the logs' latest seq and hash go on-chain in a self-transaction from the compliance key. `GET /portal/v1/audit/verify` checks the log against every anchor, so even a log rewritten in full is caught.                                                                     |
| Logs            | `src/portal/portal-store.ts` | An audit log (changes, exports) and a security log (sign-ins, refusals), each hash-chained; `GET /portal/v1/audit/verify` recomputes both.                                                                                                                                                                                  |

### Analytics

`GET /portal/v1/analytics?days=7|30|90&until=YYYY-MM-DD` gives the Overview and Trading pages
everything they draw, computed on request from the store by `src/domain/analytics.ts` (a pure
function, tested in `test/analytics.test.ts`). The choices worth defending:

- **Days are Pakistan days** (UTC+05:00). A period is `days` whole days ending `until`
  (default today); the previous period is the same length just before it, so every figure has a
  like-for-like comparison.
- **Custody is rebuilt from confirmed trades**, not read from the chain, so it can be shown for
  any past day. A buy adds grams, a sale removes them, and a transfer counts only when it crosses
  between partners.
- **The bridge adds up exactly.** Closing value = opening + bought − sold + transferred in −
  transferred out + price effect. Trades are valued at their own quote; the price effect is what
  is left, which is the change in the value of gold already held.
- **Prices** for past days are the last quote of that day (any partner), carried forward; today
  uses the live price.
- **Medians, not averages**, for buy size and settlement time (nearest-rank percentiles), because
  a few large buys or one slow block would drag an average.
- **Price-band cancellations** are failed trades with code `price_moved` (the contract's 50 bps
  check), over trades that finished.

### Simulated history

`pnpm --filter @mohar/api simulate --partner sim-bank [--savers 200 --days 90 --seed 1]`
(`src/sim/`) writes a demonstration partner's history so the portal has something to show. It
models four kinds of saver (habit, occasional, large, dormant), a gold price that moves like a
random walk with 18% yearly volatility and ends at the live price, quotes that expire or fail
the price band more often on volatile days, and settlement times around 2.4 s. The same seed
always gives the same history.

It cannot be confused with real data: it runs only against chain 31337 with the API stopped;
the partner's slug must start `sim-`; every record carries `simulated: true`; the store refuses
simulated records for a partner that has real ones, and real ones are never cleared; and a
`sim-` partner's portal users can only be viewers. The analytics say `simulated: true`, and the
portal shows a banner.

A MOHAR operator adds, unlocks, locks and resets portal users on the portal's operator page
(`/portal/v1/admin/users`); a new or reset user's password and QR code are shown once. The very
first operator is added from the terminal, with the API stopped (it would overwrite the file):

```bash
pnpm --filter @mohar/api portal:user add --email dev@demo-bank.test --role developer --partner demo-bank
pnpm --filter @mohar/api portal:user list
```

The new user's password, a QR code for the authenticator app and the setup key are printed once, to that terminal only. On
Amoy, prefix the command with `DOTENV_CONFIG_PATH=.env.amoy`, as for the API.

## Tests

```bash
pnpm --filter @mohar/api test    # unit: pricing, HTTP, auth, idempotency, portal
pnpm test:e2e                    # full flow on a throwaway Anvil chain (needs Foundry)
```

The end-to-end test is the demo script in code: register → buy PKR 25,000 → webhook verified →
reserve fully backed and provable per wallet → transfer → sell → oversell refused → 1% price
jump rejected with `price_moved`.
