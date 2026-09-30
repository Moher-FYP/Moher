# Demo Bank

A mock partner bank that offers "Gold Savings" to its customers by integrating MOHAR through
`@mohar/sdk`. It exists to demonstrate the B2B model: customers never see the MOHAR brand, and
the bank never touches blockchain details.

## Run

```bash
cp .env.example .env.local
pnpm --filter @mohar/sdk build      # the app imports the built SDK
pnpm --filter @mohar/demo-bank dev  # http://localhost:3000
```

Start the API too (`pnpm --filter @mohar/api dev`) or the page shows "Not connected".

## Rules

- Call MOHAR only from server code (Server Components, Server Actions, Route Handlers) via
  `getMohar()` in `src/lib/mohar.ts`. It imports `server-only`, so a client component that
  imports it fails the build — that is intentional.
- Never use `NEXT_PUBLIC_` for MOHAR settings.
- This is Next.js 16. Check `node_modules/next/dist/docs/` before relying on older patterns.
