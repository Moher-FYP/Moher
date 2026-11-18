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

`portal:user` prints each new user's password, a QR code and the setup key, once. Scan the QR
code with an authenticator app (Microsoft Authenticator: + → Other account; Google
Authenticator or Bitwarden Authenticator: + → Scan a QR code), save the password in the password
manager, then sign in with the email, the password and the app's 6-digit code. If scanning
fails, enter the setup key by hand instead. Never paste the key, the QR code or the password
into chat or a document; if one leaks, `portal:user reset` replaces both. Run `portal:user` with the API
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

After the first operator exists, add everyone else from the operator page: it shows the new
person's QR code and password once, and lists locked accounts so an operator can unlock them.

## Tests

`api/test/e2e/portal.e2e.test.ts` runs this app (`next start`) against a real local chain and
API, in Chromium through Playwright: the security headers, a refused wrong code, a freeze asked
for by compliance and carried out by an operator, a new person's QR code, and an API key that
works until it is revoked. Locally it needs the portal built and
`pnpm --filter @mohar/api exec playwright install chromium`; CI does both.

## How it connects

The browser only talks to the portal's own origin. A route (`src/app/portal/v1/[...path]/route.ts`)
passes `/portal/v1/*` through to the API named by `MOHAR_API_URL`, read on every request, so the API's session cookie (`HttpOnly`, `SameSite=Strict`, path
`/portal`) and its `Origin` check work as if the API were on this origin, and the API itself can
stay on `127.0.0.1`. A 401 anywhere (the session ends after 15 idle minutes or 8 hours) sends the
user back to sign in.

The route forwards the client's address in `X-Forwarded-For`, and the API trusts that header
only from this machine (`TRUST_PROXY=loopback`), so the logs and the per-address sign-in limit
see the person, not the portal. Behind a reverse proxy, that proxy must set the header.

## Changing the look

Every colour, the font and the corner radii are in `src/app/theme.css`. Pages and components
use only those names (`bg-surface`, `text-ink-soft`, `border-line`, …), so the team's design
system replaces that one file. Shared pieces (cards, tables, badges, buttons, fields) are in
`src/components/ui.tsx`.
