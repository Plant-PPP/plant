# Threat model: movements, manual prices and the report exclusions

Branch `feat/pla-103-movements-db` (PLA-103, PLA-104, PLA-122). The PR template requires it for a change in RLS and a new field with financial data: every movement carries amounts and units, and the first RPC opens a new endpoint.

## Scope and assets

- **What it protects:** each user's operations and movements (units, prices, amounts, charges, the dollar rates of their dates), manual prices and dollar rates, the assets left out of the tax report, and the amount and revision of the instrument holdings the movements move.
- **Left out:** the app half (server actions and readers, the next PR) and imports.

## Trust boundary

- **The user's own input** reaches PostgREST directly, through the tables' column grants and `rpc/write_operation`; the app's server actions use the same API. Everything a request carries is untrusted: ids (another user's account, portfolio, holding or operation), the parts' JSON, and the expected revisions.
- **Instruments** are seeded by migrations, and nobody writes them through the API.

## Data flow

1. The browser calls a server action in `apps/web`, which validates the operation with core and calls `write_operation` with the session's token. Or an attacker calls PostgREST directly with their own token.
2. PostgREST runs `public.write_operation` as `authenticated`, with RLS on.
3. The function takes the user's portfolio setup lock, checks the expected revisions, replaces the operation's movements, creates or finds each part's holding, and settles the holdings it touched.

## Where it is enforced

- **RLS:** the owner predicate in `USING` and `WITH CHECK`, and the MFA gate, on every new table.
- **Column grants:** `authenticated` never writes `user_id`, `id`, `rank` or `created_at`. Movements and operations are never updated. Manual prices and rates update only their value.
- **Composite foreign keys** pair `user_id` with `user_id`, so a movement points only at its user's holding and operation, and an exclusion only at its user's holding.
- **The RPC runs as the caller** (`SECURITY INVOKER`, empty `search_path`), so it can do nothing the caller cannot do one statement at a time. Its own checks are `not_found` for an operation the caller does not see, `stale` and `negative_units`.

## STRIDE

|       | Vector                                                                | Control                                                                                                                                                                                                       |
| ----- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **S** | A request acts as another user                                        | The JWT's `sub` is `auth.uid()`. Every policy and the RPC filter by it, and `user_id` defaults to it with no write grant.                                                                                     |
| **T** | Writing into another user's account, portfolio, holding or operation  | Composite foreign keys answer 23503 with no hint, alike for another user's id and one that does not exist. The RPC answers `not_found` for another user's operation. pgTAP and pentest specs cover each case. |
| **T** | A history that goes below zero, or a write computed from a stale read | `negative_units` and `stale`, inside the user's lock.                                                                                                                                                         |
| **R** | A user denies a write                                                 | Not covered: `audit_log` records auth events only. Accepted for the beta, since a user only changes their own data.                                                                                           |
| **I** | Reading or probing another user's rows                                | RLS returns nothing. Every unique key includes `user_id`. Foreign key errors carry no hint.                                                                                                                   |
| **D** | A huge operation                                                      | At most 20 parts and 10 charges, and a user's writes queue behind their own lock only.                                                                                                                        |
| **E** | The RPC as a way past RLS                                             | It runs as the caller. The floor allows `authenticated` to execute exactly the listed RPCs and requires each to run as the caller with an empty `search_path`.                                                |

## Controls as built

- **Owner isolation on the five tables:** `supabase/tests/movements_isolation_test.sql` and each table's pentest spec (`*.pentest.test.ts`) through `describeAnotherUserAccess`.
- **The RPC's rules:** `movements_isolation_test.sql` covers the entry order, the opening balance's rank, `stale`, `negative_units`, edit, delete, the empty holding's deletion and `not_found`. `write-operation.pentest.test.ts` covers anon, another user's operation, account and portfolio.
- **Only that RPC is executable:** the floor in `schema_rls_and_grants_test.sql`.

## Residual risk

- **A user can corrupt their own data.** They can write movements and holding amounts directly, past the RPC's invariants. Only their own data suffers, and the app always writes through the RPC.
- **The JSON in `charges` and `rates` is checked only for its shape** (a list of at most 10, an object). The app validates its contents with core's schemas. A user writing their own malformed JSON breaks only their own pages, which parse it before use.
