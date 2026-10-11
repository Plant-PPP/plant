# Threat model: Activos screen and holdings writes

Branch `feat/pla-28-manual-holdings` (PLA-28). Required by the trigger "New field with financial or personal data": the app now reads and writes holdings, the user's amounts and positions, and reads quotes, through server actions and a server page. It builds on [the holdings model](2026-10-10-holdings.md), whose RLS, grants, foreign keys and guards are unchanged.

## Scope and assets

- The user's holdings as the page reads them, with their account and portfolio, and the values core computes from them.
- The holdings server actions: create, edit (including a move to another portfolio), archive and restore.
- The quote read: the rates and prices the valuation needs, for the day and the seven days before it.
- The log lines both emit.

Out of scope: manual prices, instruments beyond crypto, transactions and imports (the second PLA-28 PR), and the daily valuation job (PLA-27).

## Trust boundary

Everything a server action receives comes from the browser: the holding id, every field of the payload, and any extra key. The page's search params (`moneda`, `cartera`, `tipo`, `buscar`, `vista`, `tenencias`) are untrusted too. The session comes from the Supabase cookie, verified by `getSessionClaims`.

## Data flow

1. `/assets` (server) reads the user's holdings, accounts, portfolios, instruments and reference dollar with the user's client, then the quotes through `createQuoteReader(client)`, and values them in `@plant/core`.
2. The page hands the rows and the computed values to the client component, which shows them and runs one write at a time.
3. A write calls a server action in `app/(app)/assets/actions.ts`, which goes through the portfolio-setup runner: the session's user, a zod parse of every argument, the write with the user's client, one log line, a page refresh.

## Where it is enforced

- **Every read and write uses the user's JWT**: RLS and the MFA gate apply, and owned reads add `.eq("user_id", …)`. Nothing here uses the service role.
- **Server actions** parse the id as a uuid and the payload with a strict schema per class (`lib/holdings/schemas.ts`): unknown keys (`user_id`, `id`, `archived_at`) are refused, and an edit cannot carry the account or the instrument. A test checks every key the schemas write against the grants the pgTAP pin asserts. An edit filters by `user_id`, `id`, `asset_class` and `archived_at IS NULL`; archive and restore filter by `user_id`, `id` and the archived state, and a restore only clears `archived_at`.
- **Foreign keys and guards** (unchanged) keep a holding on its own user's account and portfolio and refuse an archived one; another user's ids fail with no hint.
- **Search params** are matched against known values (a unit in `DENOMINATORS`, a portfolio id the user's read returned, a holding class, a tab); anything else falls back to the default. `buscar` is free text: it is trimmed, refused past 60 characters, matched in memory against the holdings already read, and never logged (only whether there was one).
- **Logs** carry ids, counts, booleans, the unit and outcome codes, never amounts, labels or values; `credential-scrub.ts` masks keys named for totals, values, rates and labels.

## STRIDE

|       | Vector                                                              | Control                                                                                    |
| ----- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **S** | Calling an action as another user                                   | The user comes from the session's claims, never from the payload                          |
| **T** | Editing, moving or archiving another user's holding                 | `user_id` filter plus RLS: no row matches, `not_found`                                     |
| **T** | Moving a holding into another user's portfolio, or changing its class, account or instrument | Composite foreign keys; the update filters by class; the schema refuses the account and the instrument; the grants refuse the account and the class |
| **R** | An action with no trace                                             | One `portfolio_setup.write` line per call, with the request id, user, action and outcome  |
| **I** | Values or labels in logs                                            | Only ids and counts are logged; the scrubber masks value-named keys                        |
| **I** | Another user's holdings through an embed or a crafted param         | RLS on every embedded table; params only pick among the user's own rows                    |
| **D** | A huge quote read, or a cut one taken as whole                      | The range is bounded and symbols chunked under `max_rows`; an exact count refuses a cut answer |
| **E** | A server action used as a privileged primitive                      | No service role; each action derives the user itself                                       |

## Controls as built

- `app/(app)/assets/actions.test.ts`: the exact write chains and filters, unknown keys and the account or instrument refused with no write, another user's account or portfolio (`23503`) and a missing column (`23502`) answered as `failed` and logged by code only, the logged lines free of amounts.
- `lib/holdings/schemas.test.ts`: every class's keys against the pgTAP grant pin.
- `lib/quotes/quote-reader.test.ts`: the filters, casts, counts and limits, truncation (206) refused, range bounds, error codes with no row data.
- `app/(app)/assets/page.test.tsx` and `lib/holdings/read.test.ts`: the `user_id` filters, the log lines, invalid params.

## Residual risk

- **The hosted `max_rows`** is not read by any test. A value below 1000 makes the quote read refuse and the page fail with a logged `QuoteReadTruncated`, never show partial values.
- **A call that never reaches the server** still leaves no server-side line, as for the accounts page.
