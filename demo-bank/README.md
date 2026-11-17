# Demo partners: Moher Bank and Moher Wallet

Two mock Pakistani partners that offer **Gold Savings** to their customers by integrating
MOHAR through `@mohar/sdk`: a retail bank and a mobile wallet. They are one app run twice, to
show the B2B model: any partner plugs into the same API, its customers only ever see the
partner, and the partner never touches blockchain details. Both names are invented.

| Partner      | Run               | Port | MOHAR partner  | New customers open at |
| ------------ | ----------------- | ---- | -------------- | --------------------- |
| Moher Bank   | `pnpm dev`        | 3000 | `demo-bank`    | standard KYC          |
| Moher Wallet | `pnpm dev:wallet` | 3001 | `moher-wallet` | asaan (basic) KYC     |

`DEMO_PARTNER=wallet` picks the wallet; anything else is the bank. Each has its own API key,
webhook secret, session cookie and customers.

## Run

```bash
pnpm chain                                    # local blockchain
pnpm contracts:deploy:local                   # contracts (after every chain restart)
pnpm --filter @mohar/sdk build
pnpm --filter @mohar/api dev                  # MOHAR API on :4000
pnpm --filter @mohar/demo-bank dev            # Moher Bank on :3000
pnpm --filter @mohar/demo-bank dev:wallet     # Moher Wallet on :3001
```

Open either, and sign in as a persona (bank: Hassan, Bushra; wallet: Aliya, Kamran) or open a
new account. No `.env.local` is needed locally; `.env.example` lists the settings.

## Opening an account

The sign-up screen runs the partner's side of KYC, **simulated** (`src/lib/onboarding.ts`):
CNIC details and a photo (the photo is checked for type and size, never read or kept), a
simulated NADRA check, sanctions screening, and a risk score from occupation, source of funds,
expected amount and political exposure. Low and medium risk open Gold Savings at once; high
risk is referred to a compliance officer and stays closed. MOHAR receives only the KYC level
and a reference to the partner's record, never the CNIC.

To show each outcome: any made-up name opens; "Test Exposed Person", or ticking the public
office box, is referred; "Test Blocked Person" is refused.

The checks follow the State Bank's rules for opening an account (`docs/kyc-limits.md`): one
account per CNIC at each partner, a mobile number not already used by another customer, no
account on an expired CNIC, and customers aged 18 and over. NADRA verification, the mobile
operator's SIM check and the screening lists are simulated.

MOHAR enforces limits per KYC level (the API's `KYC_LIMITS`) on everything a customer receives,
bought or sent to them, and the app explains a refusal in plain words. Records are kept in
`.data/` per partner: customers (masked CNIC and phone, plus keyed fingerprints to spot a
repeat), the customer-to-wallet mapping, and how each trade was paid.

## Screens

| Screen                 | What it shows                                                                  |
| ---------------------- | ------------------------------------------------------------------------------ |
| Sign in                | Pick a persona, or open a new account. Gold Savings registers a MOHAR wallet.  |
| Open an account        | The partner's KYC, simulated: CNIC, screening, risk band, then the outcome.    |
| Home                   | Gold balance in grams and rupees, the price per gram, recent activity.         |
| Buy gold               | Spend from Rs 100, paid from the partner account or by Raast (simulated).      |
| Sell gold              | Sell any amount, or everything.                                                |
| Send gold              | Move gold to another customer.                                                 |
| Transaction            | Live status while the trade settles; a plain explanation if it is cancelled.   |
| Receipt                | Printable receipt for a settled trade: grams, price, margin, ledger reference. |
| Your gold in the vault | Proof-of-Reserve, plus an on-chain check of this customer's own gold.          |

The right-hand **Behind the scenes** panel lists every SDK call the bank's server makes and
every signed webhook MOHAR sends back. It also has a price control for the slippage demo: get a
price, press "Gold up 1%", then confirm — the contract cancels the trade and nothing is charged.

## How it integrates

- All MOHAR calls run on the server (Server Components, Server Actions, Route Handlers) through
  `src/lib/mohar.ts`, which imports `server-only`. The API key never reaches the browser.
- Each trade uses the quote id as its idempotency key, so a double click cannot buy twice.
- `src/app/api/mohar/webhooks/route.ts` verifies MOHAR's webhooks with the SDK.
- The partner keeps its own mapping of customer to MOHAR wallet (`src/lib/session.ts`) and how
  each trade was paid (`src/lib/payments.ts`), saved in `.data/`; the quotes it has shown
  (`src/lib/quotes.ts`) stay in memory, since they expire in a minute.
- The session cookie is signed (`SESSION_SECRET`) and sent over HTTPS only in production, so a
  customer cannot change it to become someone else. The login screen asks for no password: it
  stands in for the partner's own sign-in, which MOHAR does not replace.
- In production (`next build` / `next start`), `SESSION_SECRET` and `CUSTOMER_HASH_SECRET`
  must be set; the local stand-ins are public in this repository.

This is Next.js 16. Check `node_modules/next/dist/docs/` before relying on older patterns.
