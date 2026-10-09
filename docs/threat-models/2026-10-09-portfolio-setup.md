# Threat model: portfolios

Branch `claude/project-thread-yfghow` (PLA-95). Required by the trigger "Change in authentication, session, MFA or RLS": it adds an owned table with RLS, changes the signup function and adds the first guards that refuse an owner's own write.

## Scope and assets

- `public.portfolios`: the names a user gives to groups of holdings, and whether each one is archived. PLA-24's accounts and PLA-25's holdings will point at them, so a portfolio of another user must never be reachable.
- The invariant that every user keeps at least one active portfolio, which the views of PLA-25 onwards rely on.

Out of scope: holders and accounts (PLA-24) and holdings (PLA-25), which extend these guards.

## Trust boundary

The browser talks to PostgREST with the user's JWT (role `authenticated`) or without a session (`anon`). Everything the client sends is untrusted: ids, names, `archived_at` and filters.

## Data flow

1. On sign-up, `private.create_profile_for_new_user` (`SECURITY DEFINER`) creates the profile and the "Principal" portfolio. The migration gave every existing user one.
2. The `/accounts` page reads the user's portfolios, and its server actions create, rename, archive and restore them through PostgREST with the user's JWT, as `authenticated`. Any client can also call PostgREST directly with its own token.
3. On every insert and update, the `portfolio_setup_*` triggers take the user's advisory lock, stamp `archived_at` and refuse archiving the last active portfolio.

## Where it is enforced

- RLS `portfolios_owner`: `user_id = (select auth.uid())` in `USING` and `WITH CHECK`, plus the restrictive MFA gate.
- Column grants: `authenticated` inserts only `name` and updates only `name` and `archived_at`; `user_id` comes from its default. No API role holds `DELETE` (a portfolio goes only with its account); `anon` and `service_role` hold nothing.
- CHECK: names of 1 to 40 characters with no outer spaces; a unique index on `(user_id, lower(name))` among active portfolios.
- Triggers (`SECURITY INVOKER`, `search_path = ''`, not executable by the API roles): the lock serializes one user's writes, the stamp sets `archived_at` to the server's time the row was archived, the guard refuses archiving the last active portfolio with `PT409` and the hint `last_active_portfolio`. They key on the row's `user_id`, never on `auth.uid()`, because the signup function, the seed and the owner write past RLS.
- `UNIQUE (user_id, id)`: the target of the composite foreign keys PLA-24 and PLA-25 add, so a row can only point at a portfolio of its own user.

- Server actions: each calls `getSessionClaims()`, parses every argument with zod (a uuid id, a trimmed name within the CHECK's limit), filters by the session's `user_id` and the id besides RLS, and logs one line without names or PostgREST's text.

## STRIDE

|       | Vector                                                           | Control                                                                                                                                                     |
| ----- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **S** | Creating a portfolio in another user's name                      | No grant on `user_id`; `WITH CHECK` against `auth.uid()`                                                                                                    |
| **T** | Renaming, archiving or deleting another user's portfolio         | `USING` by `user_id` filters the update to nothing; no `DELETE` grant                                                                                       |
| **T** | Back-dating `archived_at`, or moving a portfolio to another user | The stamp trigger overwrites `archived_at`; no grant on `user_id`                                                                                           |
| **R** | Not knowing when a portfolio was archived                        | `archived_at` is set by the database when the row is archived                                                                                               |
| **I** | Reading another user's portfolio names, or probing ids           | RLS by `user_id`; no upsert grant over another user's id; `anon` without privileges                                                                         |
| **D** | Huge names, or archiving every portfolio to break later views    | Length CHECK; the guard keeps one active portfolio, serialized by the lock so two concurrent archives cannot both pass (at READ COMMITTED, the API's level) |
| **E** | A trigger or the signup function used to write past RLS          | Trigger functions in `private`, not executable by the API roles; the signup function is pinned by the floor to its table owner                              |

## Controls as built

- **pgTAP** (`supabase/tests/portfolio_setup_isolation_test.sql`): the exact grants of `authenticated` and that `anon`, `service_role` and `PUBLIC` hold nothing, the function and trigger definitions and their order, the lock key, the CHECK and unique index, the signup's "Principal", the lock taken on insert and update, isolation between two users read row by row (`ctid`), the refused columns and `DELETE`, the duplicate and outer-space names, the stamp on first archive and its keep on a re-archive, the guard under another user's claims, the restore, the policy refusing an insert, a move and an upsert takeover with the grants widened, and the cascade on account deletion. A widened grant, a guard reading `auth.uid()`, a stamp that rewrites, an open policy, or a lock taken on insert only or skipped on an early return each turns it red.
- **Floor** (`schema_rls_and_grants_test.sql`): the signup function's owner must also own `portfolios`, besides the owned-table shape every table passes.
- **PostgREST** (`security-tests/src/portfolios.pentest.test.ts`): the shared cross-user cases, a PATCH and an archive of another user's portfolios that change nothing, moving one's own row to another user, archiving one's last active portfolio (409, `PT409`, the hint) and archiving the last two at once, which fails without the lock, a duplicate name in another case (409, `23505`), `DELETE` and the server's columns refused.

- **Server actions** (`app/(app)/accounts/actions.test.ts`): the filters by user and id, the zod refusals before any client, the mapping of every refusal, the session's redirect propagating, an update matching no row or two, and a log line with no name or PostgREST text on every outcome.

## Residual risk

- **A data migration over many users' rows takes one advisory lock per user until commit.** It disables the lock trigger around it or batches per user (`docs/decisions.md`).
- **A rejected action has no server-side signal** (network, version skew), as everywhere in the app until client telemetry exists.
- **A failing "Principal" insert fails signup** with Auth's generic error and no Plant log, as the profile insert already does.
