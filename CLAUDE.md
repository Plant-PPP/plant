# Plant

Web app for Argentine investors to see their whole net worth in pesos and in MEP dollars: they upload what they already have (broker PDF, screenshots, CSV or Excel), the AI builds the portfolio, and the user reviews and confirms it. It is **read-only**: it never trades, transfers or holds custody, and there are no buy or sell buttons.

Skill paths and agent routing are in [`AGENTS.md`](AGENTS.md).

## Setup

pnpm + turbo monorepo. You need Node >= 22, pnpm (`corepack enable`) and Docker.

```bash
pnpm install
pnpm preflight                      # checks what is missing
vercel env pull apps/web/.env.local # development keys (Gemini, Anthropic), optional at first
pnpm dev:up                         # local Supabase + web on :3000 + Inngest dev on :8288
```

`pnpm dev:up` starts Supabase if it is not running, writes `apps/web/.env.development.local` with the local URLs and keys (`pnpm env:local`) and starts the web app and the Inngest dev server, which registers the functions in `/api/inngest`. Stop it with Ctrl-C.

## Structure

| Package            | What it holds                                                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`         | Next.js 16 (App Router) + React 19 on Vercel `gru1`. Includes `/api/inngest` (the chat arrives with the "Asistente" stage)                              |
| `packages/shared`  | Money (`Money` as a decimal string with its currency). Database types generated in `src/db/generated/`. `pricing.ts`, `ai-cost.ts` and `prompt-text.ts` |
| `packages/sources` | `PortfolioSourcePort` and the `file_upload` adapter (arrive with the "Carga con IA" stage)                                                              |
| `packages/core`    | Valuation and portfolio functions used by the UI and the assistant (arrive with the "Patrimonio manual" stage)                                          |
| `packages/jobs`    | Inngest client, a test `ping` function and the `/api/inngest` options. The `JobRunner` port arrives with the "Carga con IA" stage                       |
| `supabase/`        | Config, migrations and pgTAP tests (`supabase/tests/`, run in the CI `database` job)                                                                    |
| `evals/`           | Extraction and assistant evals (the real documents live outside the repo)                                                                               |
| `security-tests/`  | Pentest specs over HTTP: `anon`, another user and the owner on every `public` table and view; a new one fails typecheck without a spec                  |

Packages export their TypeScript sources and `apps/web` compiles them with `transpilePackages`, so they don't need a build before starting the web app. Which package may depend on which is checked by `pnpm check:boundaries` (`scripts/check-package-boundaries.mjs`) over the `package.json` files, `inngest` is declared only in `packages/jobs` and `apps/web`, and `ai` and `@ai-sdk/*` only in `apps/web` and `evals`. The check includes the root `package.json`, because every package sees its `node_modules`; don't import another package through relative paths (`../../jobs/src`).

## Tests and checks

```bash
pnpm check          # typecheck + lint of every package
pnpm test           # package tests
pnpm test:scripts   # scripts/ tests (squawk, migrations, package boundaries, web import fences)
pnpm test:security  # pentest specs against local PostgREST (needs `supabase start`)
pnpm test:e2e       # Playwright against a production build of apps/web
pnpm turbo:affected # only what changed against origin/staging
pnpm format         # prettier over what changed
```

Husky (`.husky/`, logic in `scripts/hooks/`) runs prettier and the forbidden-words check on pre-commit, the same check on the message in `commit-msg`, and on pre-push the check over the commits, authors and name of every branch you push, plus typecheck, lint and tests of what is affected. CI repeats all of that, plus `pnpm audit`, the package boundaries, the `e2e` job (Playwright: the CSP, eval blocked, login hydrating) and the `database` job (on PRs, append-only migrations; on PRs and pushes, the new migrations' name, version, transaction and squawk, script tests, up-to-date types, pgTAP and the pentest specs).

## Language

Everything in the repo is English: code, identifiers, comments, test names, migrations, scripts, developer-facing messages (thrown errors, logs, CI), docs, skills, rules, templates, commits, branch names and PRs. Spanish from Argentina with voseo is only for what a Plant user reads: UI copy and app metadata, emails, assistant answers and the bug-report form (`.github/ISSUE_TEMPLATE/error.yml`). Fixtures, assertions and examples that mirror user-facing text keep it as the user sees it. Validation messages in packages are English; the UI maps them to its own copy. Linear stays in Spanish, so stage names and Linear headings are quoted as written there.

## Branches, commits and PRs

- `staging` is the only working branch and it is protected. Work on your own branch named `<type>/<slug>` in English, with the Linear key when there is an issue (`feat/pla-12-job-runner`), and open a PR to `staging`.
- A merge to `staging` deploys code and migrations to staging (see Supabase). A PR that adds migrations or touches `.github/workflows/` is merged by Tomas; an agent never merges it on its own, and never approves a deployment.
- **Never push to `production`.** It is a frozen branch that exists only because Vercel requires a Production Branch. Production will ship through the _Promote to production_ workflow (PLA-13), which will tag the commit `production-latest`. There is no `main`.
- A commit you write is a single Conventional Commits subject line in English, under 70 characters: no body and no trailers (`Co-Authored-By:`, `Claude-Session:`). This overrides any tool's default attribution.
- PR titles use the same format with the Linear key (omitted only when there is no Linear issue). Whoever merges uses Squash and merge, keeps the PR title as the commit title (GitHub's appended ` (#N)` may stay) and clears the message box, so the PR title is the commit on `staging`. Destructive migrations: `[DESTRUCTIVE]` at the start of the title, before any stacked-PR `(N/X)` marker, which is dropped from the squash commit title (see `nav-github`); the squash commit title keeps `[DESTRUCTIVE]`, the only prefix it may have before the type.
- Branches named `claude/*` get no Vercel preview while their PR is a draft. Marking it ready for review deploys one (`.github/workflows/preview.yml`); post the link from the PR's `vercel-preview` deployment with the ready-for-review message.
- The PR body starts with `## Intent` and follows the template in `.github/pull_request_template.md`.

## Supabase

**Never run `supabase db push`.** The `deploy-migrations` job in `ci.yml` applies migrations to `plant-staging` on every merge to `staging` that leaves one unapplied since the last deploy, after the `database` job and Tomas's approval in GitHub. Until the beta that database is also production's: migrations are additive only (a `DROP` or `RENAME` waits until production runs code that no longer uses it), and after merging one, check that the deploy goes green.

```bash
pnpm exec supabase migration new <name>
pnpm db:reset                       # rebuilds the local database from the migrations and supabase/seed.sql
pnpm db:generate:supabase-types     # after every migration; pre-push fails if they are stale
```

- A migration applied on staging is read-only: changes go in a new migration.
- Every new migration passes squawk (`.squawk.toml`). Copy the header from `scripts/fixtures/squawk/pass-migration-header.sql`; `statement_timeout = 0` only with the reason in a comment. Any `... INDEX CONCURRENTLY` statement goes alone in its migration, without the header, like `pass-concurrent-index-alone.sql`. The PLA-16 migration predates squawk: do not use it as a model.
- RLS on every table from the moment it is created, with `user_id = (select auth.uid())` in `USING` and `WITH CHECK`.
- "Automatically expose new tables" is off (`auto_expose_new_tables = false` in `supabase/config.toml` and in the dashboard): every migration makes an explicit `GRANT` to `authenticated` with only the operations the app uses. Never to `anon`.
- Every table starts with `REVOKE ALL`, and `authenticated` writes only through column-level grants, never on `user_id`. The full shape of owned tables is in `docs/decisions.md`; the pgTAP floor checks part of it and each table's two-user test checks the rest.
- Explicit `REVOKE ... FROM PUBLIC, anon, authenticated` on functions, and `SECURITY DEFINER` always with `SET search_path`.
- Money as `numeric` in Postgres and as a decimal string in the contract, never as a float. Every amount carries its currency.

## Environment variables

- `apps/web/.env.local` comes **only** from `vercel env pull apps/web/.env.local`; don't edit it by hand.
- `apps/web/.env.development.local` is written by `pnpm env:local` with local Supabase.
- `.env.example` lists the names without values. If you add a variable, add it there and on every platform.

## Public repo

- None of these ever goes into the repo, its commits or its PRs: a `.env`, a key, a real document, personal data, the plan or the internal analyses. Test fixtures are made up.
- The reference app that patterns are ported from is never named: not in code, comments, commits, branches, PRs, skills or docs. Say "the reference app" or describe the pattern. `pnpm check:forbidden-words` checks it if you have `FORBIDDEN_WORDS` in your shell.
- Actions with `permissions: contents: read`, pinned by SHA, and never `pull_request_target` with a checkout of the PR.

## Product

- All user-facing UI is in Spanish from Argentina with voseo (dev-only strings hidden in production are English). Numbers in `es-AR` format (`$ 1.234.567,89`, `US$ 12.345,67`).
- The assistant explains, summarizes and compares. It **never recommends buying or selling** and shows the notice that it is not financial advice.
- Chart numbers never come from the model: the server loads the data and builds the Vega-Lite spec.
- Text from documents and from the user goes through `prompt-text.ts` and is treated as untrusted. The assistant's tools are read-only and filter by the session's user.
- The AI ignores DNI, CUIT and CBU. Amounts, holdings, CUIT, tokens and the extracted JSON are never logged.
- Server code logs through `serverLog` (`apps/web/src/lib/log/server-log.ts`), never `console.*`: flat fields, ids and counts, never values.
- If something is not specified, pick the simplest option and record it in `docs/decisions.md`.

## Comments and PR prose

Don't defend a decision nobody would question. Before explaining why something is _not there_, or why an alternative was not taken, ask yourself: would a competent reader assume it should be there and file a bug if it were missing? If yes, explain it. If not, delete it: the explanation only plants the idea it answers.

The same goes for PR titles, PR bodies and commit subjects, plus: describe the current state of the change and why, not how you got there. No narrating iterations ("fixed in the second commit", "addressed the review") and no diff stats: GitHub already shows them.
