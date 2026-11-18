# MOHAR partner portal

Where a partner's staff run their MOHAR integration, and where MOHAR's operators look after every
partner. Next.js 16 on port 3002. It calls only the portal routes of the MOHAR API
(`docs/portal-openapi.yaml`); it never holds an API key, a private key or a session token.

## Run it

```bash
# with Anvil, the contracts and the API running (see the root README)
pnpm --filter @mohar/api portal:user add --email dev@demo-bank.test --role developer --partner demo-bank
pnpm --filter @mohar/api portal:user add --email ops@mohar.test --role operator
pnpm --filter @mohar/api dev
pnpm --filter @mohar/portal dev     # http://localhost:3002
```

`portal:user` prints each new user's password and authenticator setup key once. Add the key to
an authenticator app (Google or Microsoft Authenticator: "enter a setup key", time-based), then
sign in with the email, the password and the app's 6-digit code. Run `portal:user` with the API
stopped. Against Amoy, prefix both API commands with `DOTENV_CONFIG_PATH=.env.amoy`.

`MOHAR_API_URL` (default `http://127.0.0.1:4000`) says where the API is; `.env.example` has it.

## Pages

| Page                  | Who            | What                                                                     |
| --------------------- | -------------- | ------------------------------------------------------------------------ |
| Overview              | partner staff  | Customers, gold held, 30-day volume, failures, reserve, latest trades    |
| Customers             | partner staff  | Search wallets; one wallet's gold, KYC limits used and transactions      |
| Transactions          | partner staff  | Filter; one trade from quote to block; CSV export for compliance         |
| Limits and reserve    | partner staff  | KYC limits per level, customers at each, proof of reserve                |
| API keys and webhooks | developer      | Create and revoke keys, webhook URL and secret, delivery log with resend |
| Compliance            | compliance     | Freeze requests, the audit and security logs and their hash-chain check  |
| Partners and freezes  | MOHAR operator | Every partner, freeze requests to approve or reject                      |
| Audit log             | MOHAR operator | Every partner's log entries                                              |

A freeze is asked for on a customer's page by the partner's compliance user and carried out on
the Partners and freezes page by a MOHAR operator, from MOHAR's compliance key.

## How it connects

The browser only talks to the portal's own origin. `next.config.ts` passes `/portal/v1/*`
through to the API, so the API's session cookie (`HttpOnly`, `SameSite=Strict`, path
`/portal`) and its `Origin` check work as if the API were on this origin, and the API itself can
stay on `127.0.0.1`. A 401 anywhere (the session ends after 15 idle minutes or 8 hours) sends the
user back to sign in.

Because every request reaches the API through this proxy, the API sees the portal's address,
not the user's: the logs show `127.0.0.1`, and the per-address sign-in limit counts all portal
users together. The per-account slow-down and lock still apply to each user. A real deployment
puts both behind one reverse proxy that passes the client's address.

## Changing the look

Every colour, the font and the corner radii are in `src/app/theme.css`. Pages and components
use only those names (`bg-surface`, `text-ink-soft`, `border-line`, …), so the team's design
system replaces that one file. Shared pieces (cards, tables, badges, buttons, fields) are in
`src/components/ui.tsx`.
