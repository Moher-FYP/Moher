## What

<!-- One or two sentences. Link the issue: "Closes #12" -->

## Why

<!-- The requirement or decision this serves (FYP-1 section, hypothesis H1–H4, or issue). -->

## How to check

<!-- Commands a reviewer runs, or screens to click through. -->

## Checklist

- [ ] CI is green
- [ ] If the API changed: `docs/openapi.yaml` updated and `pnpm --filter @mohar/sdk generate` run
- [ ] If contracts changed: `docs/contracts.md` updated and tests added
- [ ] No secrets, private keys or `.env` files committed
- [ ] AI assistance used? Note where, for the FYP AI-use declaration
