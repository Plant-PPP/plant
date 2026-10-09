# Plant

Your whole net worth, in pesos and in dollars. Plant is a web app for Argentine investors: you upload what you already have (broker PDF, screenshots, CSV or Excel), the AI builds your portfolio, and you review and confirm it. It is read-only: it never trades or moves money.

## Getting started

```bash
pnpm install
pnpm preflight
pnpm dev:up      # local Supabase, web on http://localhost:3000 and Inngest on http://localhost:8288, both on 127.0.0.1 (the Inngest gateway ports are not; see its threat model)
```

You need Node 22 or newer, pnpm and Docker. Everything else (structure, commands, branches, migrations and rules) is in [`CLAUDE.md`](CLAUDE.md).

## Branches

Your own branch → PR to `staging` → automatic deploy to staging. Production will ship through the _Promote to production_ workflow (PLA-13), which tags the commit `production-latest`.
