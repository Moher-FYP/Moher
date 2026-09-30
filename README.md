# MOHAR — Shariah-compliant gold tokenization

Final Year Project, BS FinTech, FAST-NUCES Islamabad (FYP-2, due December 2026).
Supervisor: Sir Adil A. Kazi.

MOHAR is **B2B infrastructure**: banks, neobanks and wallets integrate it through an SDK to offer
fractional, fully allocated gold to their own customers under their own brand. MOHAR handles
pricing, vault allocation, on-chain settlement and Proof-of-Reserve, designed around
AAOIFI Shariah Standard No. 57. The partner handles customers: onboarding, KYC/AML and fiat.

## How it fits together

```
Demo bank web app (Next.js)          ← stands in for a partner bank
        │  server-side only
   @mohar/sdk (TypeScript)
        │  HTTPS + API key
   MOHAR API (Node/Express) ── mock vault (signs EIP-712 attestations)
        │  relayer wallet
   Contracts on Polygon Amoy: MoharToken · WalletRegistry · ReserveRegistry
```

| Folder       | What                                              | Docs                  |
| ------------ | ------------------------------------------------- | --------------------- |
| `contracts/` | Solidity 0.8.24, OpenZeppelin 5, Foundry          | `docs/contracts.md`   |
| `api/`       | Partner API, mock vault, relayer                  | `docs/openapi.yaml`   |
| `sdk/`       | `@mohar/sdk`, typed from the OpenAPI spec         | `sdk/src/client.ts`   |
| `demo-bank/` | Mock partner bank; the customer-facing demo       | `demo-bank/README.md` |
| `docs/`      | Specs — the single source of truth for interfaces |                       |

## Setup (once per machine)

**Windows:** use WSL2 (Ubuntu) and open the repo with VS Code's WSL extension. Foundry works
best there.

1. Install [Node 20+](https://nodejs.org), then `corepack enable` (gives you pnpm).
2. Install [Foundry](https://book.getfoundry.sh/getting-started/installation):
   `curl -L https://foundry.paradigm.xyz | bash` then `foundryup`.
3. Clone **with submodules** (the contract libraries live in them):
   ```bash
   git clone --recurse-submodules https://github.com/Moher-FYP/moher.git
   cd moher
   pnpm install
   ```
   Already cloned without them? Run `git submodule update --init --recursive`.
4. Copy the env templates: `api/.env.example → api/.env`,
   `demo-bank/.env.example → demo-bank/.env.local`, `contracts/.env.example → contracts/.env`.
5. Open in VS Code and accept the recommended extensions.

## Run locally

Four terminals:

```bash
pnpm chain                          # 1. local blockchain (Anvil) on :8545
pnpm --filter @mohar/api dev        # 2. API on :4000
pnpm --filter @mohar/sdk dev        # 3. SDK rebuilds on change
pnpm --filter @mohar/demo-bank dev  # 4. demo bank on :3000
```

Open http://localhost:3000 — the integration card should say **Connected**.

To put the contracts on your local chain, run `pnpm contracts:deploy:local` after `pnpm chain`
starts (repeat it whenever you restart the chain). Addresses land in
`contracts/deployments/31337.json`.

## Everyday commands

```bash
pnpm contracts:test   # Foundry tests (incl. fuzzing)
pnpm test             # API + SDK unit tests
pnpm typecheck
pnpm lint
pnpm format           # fix formatting
pnpm spec:lint        # validate docs/openapi.yaml
pnpm --filter @mohar/sdk generate   # regenerate SDK types after editing the spec
```

## How we work

- `main` is protected and always demo-able. Work on a branch (`feat/mint-flow`,
  `fix/quote-expiry`, `docs/ss57-matrix`) and open a pull request. CI must pass.
- One issue per task; milestones: **25 Oct** mint and burn end to end · **15 Nov** feature
  freeze · **1 Dec** submission.
- Interface changes start in `docs/` (spec first), then code.
- Never commit `.env` files or private keys. Testnet keys only, ever.
- Using AI help (Claude Code, this repo's `CLAUDE.md`)? Note it in the PR for the FYP AI-use
  declaration, and make sure you can explain every line at the viva.
