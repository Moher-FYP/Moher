# Acceptance run (`@mohar/uat`)

One command runs MOHAR as its users would, in a real browser:

- applicants open accounts at MOHAR Bank and MOHAR Wallet;
- customers (new ones, and the personas Hassan and Aliya) buy, sell and send gold;
- partner staff and a MOHAR operator use every part of the portal.

Every action goes in a log: who did it, in which app, with which ids, what was expected and what
happened. After each round the run also checks that the whole system still agrees with itself.

It is a test of the finished product, not a unit test: it drives the same screens and the same
API a person would. It complements `pnpm test` and `pnpm test:e2e`.

## What one round covers

| Area                  | What is checked                                                                                                                                                                                                                                                                                                               |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Open an account       | Low and medium risk open. A politically exposed applicant is referred, and no MOHAR wallet is made for them. Refused: sanctions match, under 18, expired CNIC, a CNIC already in use, a malformed CNIC                                                                                                                        |
| Buy gold              | From the account and by Raast, the receipt, under the minimum, over the KYC per-trade limit                                                                                                                                                                                                                                   |
| Price band            | A quote, then gold moves 1% before paying: the trade is cancelled and nothing is charged                                                                                                                                                                                                                                      |
| Held price            | The 60-second quote runs out, and the screen offers a new price                                                                                                                                                                                                                                                               |
| Sell and send         | In grams, in rupees, sell all (balance exactly 0), more than the balance, send to another customer                                                                                                                                                                                                                            |
| Gold in the vault     | The customer's Proof-of-Reserve check                                                                                                                                                                                                                                                                                         |
| Partner API           | No key, a wrong key, another partner's wallet, idempotency (replay and conflict), missing Idempotency-Key, bad input, an unknown quote, pagination, reserve                                                                                                                                                                   |
| Portal people         | The operator creates a viewer, a developer and a compliance user for each partner, and a duplicate email is refused. Each role signs in on the real page and opens its pages                                                                                                                                                  |
| Access control        | 15 portal routes × 4 roles, each expected 200 or 403. Staff see only their own partner's data                                                                                                                                                                                                                                 |
| API keys and webhooks | Create a key, use it, revoke it, the revoked key is refused. Webhook deliveries arrived, and one is resent                                                                                                                                                                                                                    |
| Freeze                | Compliance asks, the operator approves, the wallet is frozen on chain, a buy is refused. Then unfreeze, and a buy works again. A request that is rejected leaves the wallet active. Another partner's wallet can't be frozen                                                                                                  |
| Audit                 | CSV export holds the round's trades. Both hash-chained logs are intact, and the audit log is anchored on chain                                                                                                                                                                                                                |
| Security              | A wrong password is refused. A user is disabled (sign-in refused), enabled, then reset (the old password fails, the new one works)                                                                                                                                                                                            |
| Invariants            | Token supply equals the sum of balances. Every API balance equals its on-chain balance. The reserve covers the supply. No trade is left unfinished. Every confirmed trade has a successful receipt. A cancelled trade sent nothing to the chain. The portal's analytics match the records. Every wallet belongs to a customer |

## Two targets, two profiles

| Command         | Runs against                                                       | Profile                                                                       | Browser                           |
| --------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------- | --------------------------------- |
| `pnpm uat`      | the local Anvil stack (`pnpm chain`, deploy, API, apps, portal)    | full: everything, every round                                                 | hidden                            |
| `pnpm uat:amoy` | the Amoy deployment on the laptop that holds the `.env.amoy` files | light: every feature each round, fewer repeat trades, freezes in round 1 only | visible, slowed so you can follow |

Options go after the command: `--rounds 3`, `--profile full|light`, `--headless`, `--slow 300`
(milliseconds between browser actions).

The light profile costs about 0.1 test POL a round from the relayer. Before each round the run
checks the relayer has at least 0.12 POL, and stops if not. The freezes in round 1 cost the
compliance key about 0.006 POL. Top up from the Polygon faucet, or from the deployer.

## Before the first run

```bash
pnpm install
pnpm --filter @mohar/uat exec playwright install chromium
# WSL or Linux, once: the libraries Chromium needs (asks for your password)
sudo pnpm --filter @mohar/uat exec playwright install-deps chromium
```

On Windows 11, WSL shows the browser windows on the Windows desktop (WSLg).

## Running it on Amoy

Start everything for Amoy first, from `~/code/moher`:

- the API: `DOTENV_CONFIG_PATH=.env.amoy pnpm --filter @mohar/api dev`
- MOHAR Bank: `(set -a; . demo-bank/.env.amoy; set +a; pnpm --filter @mohar/demo-bank dev)`
- MOHAR Wallet: `(set -a; . demo-bank/.env.amoy.wallet; set +a; pnpm --filter @mohar/demo-bank dev:wallet)`
- the portal: `pnpm --filter @mohar/portal dev`

Each needs its own terminal tab. Then, in a new tab:

```bash
pnpm uat:amoy
```

It checks the API is on chain 80002 before doing anything.

## What it leaves behind

- **Everything** is in `uat/out/<target>-<date>/`. That folder is git-ignored, because it names test customers.
  - `actions.csv` / `.json`: every action. Round, time, app, actor, role, feature, action, input, expected, actual, pass or FAIL, every id, and on Amoy a Polygonscan link.
  - `partner-customers`, `mohar-wallets`, `mohar-transactions`, `mohar-quotes`: every customer, wallet, trade and quote, and how they link.
  - `portal-users`, `portal-audit-log`, `portal-security-log`, `api-keys`, `webhook-deliveries`, `freeze-requests`, `audit-anchors`: the portal's own records.
  - `gas.jsonl` (balances before and after each round), `snapshots.jsonl` and `summary.json`.
- **No secrets** are written:
  - API keys, passwords and authenticator secrets are read from the `.env` files and kept in memory only;
  - password hashes, sealed secrets, session tokens and CNIC fingerprints are left out of the export.
- **Accounts:**
  - The portal accounts the run creates, its own operator included, are disabled at the end.
  - The customers it opens stay in the demo apps and in MOHAR's records, as real customers would. On Amoy their wallets and trades stay on the public chain.
- **Sign-in limit:** the portal allows 30 sign-in attempts per IP address in 15 minutes. The run signs in many times, so it waits when it gets close to that, and says so.
