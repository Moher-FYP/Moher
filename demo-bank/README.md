# Demo Bank

A mock Pakistani partner bank that offers **Gold Savings** to its customers by integrating
MOHAR through `@mohar/sdk`. It demonstrates the B2B model: customers only ever see the bank,
and the bank never touches blockchain details.

## Run

```bash
pnpm chain                                   # local blockchain
pnpm contracts:deploy:local                  # contracts (after every chain restart)
pnpm --filter @mohar/sdk build
pnpm --filter @mohar/api dev                 # MOHAR API on :4000
pnpm --filter @mohar/demo-bank dev           # this app on :3000
```

Open http://localhost:3000 and sign in as one of the FYP personas (Hassan, Bushra, Aliya). No
`.env.local` is needed locally; `.env.example` lists the settings.

## Screens

| Screen                 | What it shows                                                                       |
| ---------------------- | ----------------------------------------------------------------------------------- |
| Sign in                | Pick a persona. Opening Gold Savings registers a MOHAR wallet after the bank's KYC. |
| Home                   | Gold balance in grams and rupees, the price per gram, recent activity.              |
| Buy gold               | Spend from Rs 100. The price is held for 60 seconds on the confirm screen.          |
| Sell gold              | Sell any amount, or everything.                                                     |
| Send gold              | Move gold to another customer.                                                      |
| Transaction            | Live status while the trade settles; a plain explanation if it is cancelled.        |
| Receipt                | Printable receipt for a settled trade: grams, price, margin, ledger reference.      |
| Your gold in the vault | Proof-of-Reserve, plus an on-chain check of this customer's own gold.               |

The right-hand **Behind the scenes** panel lists every SDK call the bank's server makes and
every signed webhook MOHAR sends back. It also has a price control for the slippage demo: get a
price, press "Gold up 1%", then confirm — the contract cancels the trade and nothing is charged.

## How it integrates

- All MOHAR calls run on the server (Server Components, Server Actions, Route Handlers) through
  `src/lib/mohar.ts`, which imports `server-only`. The API key never reaches the browser.
- Each trade uses the quote id as its idempotency key, so a double click cannot buy twice.
- `src/app/api/mohar/webhooks/route.ts` verifies MOHAR's webhooks with the SDK.
- The bank keeps its own mapping of customer to MOHAR wallet (`src/lib/session.ts`) and the
  quotes it has shown (`src/lib/quotes.ts`) — in memory, because this is a demo.

This is Next.js 16. Check `node_modules/next/dist/docs/` before relying on older patterns.
