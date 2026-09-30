# CLAUDE.md

Context for Claude (Claude Code in VS Code, or claude.ai) working in this repo. Humans: this is
also the shortest accurate description of the project's conventions.

## Project

MOHAR is a FAST-NUCES BS FinTech final year project: Shariah-compliant (AAOIFI SS-57) gold
tokenization **infrastructure** for Pakistani partner institutions. FYP-2 deliverables: this
codebase (SDK application + demo bank web app) and a thesis. Deadline: early December 2026.
Team: Abdul Wasay (PM, Shariah/compliance), Ali Riaz (technical lead), Aroob Fatima (UI/UX),
Aysha Afzal (market research).

## Architecture (do not change without a spec PR)

- **Partner owns the customer** (onboarding, KYC/AML, fiat). **MOHAR owns the gold** (pricing,
  vault allocation, settlement, Proof-of-Reserve). The demo bank plays the partner.
- Demo bank → `@mohar/sdk` (server-side only) → MOHAR API → contracts on Polygon Amoy
  (local: Anvil).
- Custodial wallets: users never hold keys or gas. The API relayer submits all transactions.
- Mint/burn: API quotes (price locked 60 s) → mock vault signs EIP-712 Allocation/Deallocation →
  relayer calls the token → contract verifies the vault signature, re-reads the oracle and
  reverts if price moved > 50 bps. One transaction = spot settlement (qabd).
- Proof-of-Reserve: vault signs total grams + Merkle root; `ReserveRegistry` pauses minting on
  shortfall; burns always stay open.

Sources of truth: `docs/openapi.yaml` (API), `docs/contracts.md` +
`contracts/src/interfaces/` (on-chain). If code and spec disagree, fix both in one PR.
`docs/api.md` explains the API internals (queue, vault book, store, webhooks).

API rules: every on-chain write goes through the single `SerialQueue` (one relayer nonce);
the vault counts an allocation when it signs and releases a de-allocation only after the burn
confirms; errors from the chain are mapped to spec codes in `src/chain/errors.ts`.

## Units — get these right

- Gold: grams with 8 decimals on-chain (`1e8` = 1 g). In the API: decimal **strings**
  (`"0.60410000"`), never JS numbers.
- Price: XAU/USD per troy ounce, 8 decimals (Chainlink format). 1 oz = 31.1035 g.
- PKR only exists off-chain (API + partner). PKR as decimal strings with 2 decimals.
- Use `bigint` for on-chain amounts in TypeScript.

## Commands

```bash
pnpm install                         # from repo root
pnpm contracts:test                  # forge test (run inside contracts/ with --offline if no network)
pnpm contracts:deploy:local          # deploy to Anvil; writes contracts/deployments/31337.json
pnpm test | typecheck | lint | build # all TS packages
pnpm test:e2e                        # Anvil + deploy + API + SDK full flow (needs Foundry)
pnpm --filter @mohar/api abi         # after contract changes (CI checks abis.ts is current)
pnpm spec:lint                       # redocly lint docs/openapi.yaml
pnpm --filter @mohar/sdk generate    # after ANY change to docs/openapi.yaml
pnpm format                          # prettier; `forge fmt` for Solidity
```

## Conventions

- TypeScript strict, ESM (`"type": "module"`, `.js` import suffixes in api/sdk).
- API errors use the shape `{ error: { code, message, details? } }` with codes from the spec.
- Money-moving POSTs require `Idempotency-Key`.
- Solidity: OpenZeppelin 5 (AccessControl, EIP712, ECDSA), custom errors, events for every
  state change, NatSpec on public functions. Tests in Foundry; fuzz where amounts vary.
- Demo bank is Next.js 16 — read `demo-bank/node_modules/next/dist/docs/` before using
  patterns from older versions. MOHAR calls only from server code via `src/lib/mohar.ts`.
- No personal data on-chain, ever. Only hashes of partner KYC references.
- Never commit secrets. `.env.example` files document every variable.

## Working agreements

- Branch + PR for everything; `main` is protected. Small PRs with a clear "How to check".
- Explain non-obvious design choices in the PR — the team must defend every line at the viva.
- Note AI assistance in PR descriptions (FYP AI-use declaration).
