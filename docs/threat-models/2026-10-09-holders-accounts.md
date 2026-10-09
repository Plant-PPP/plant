# Threat model: holders and accounts

Branch `claude/project-thread-yfghow` (PLA-24). Required by the trigger "Change in authentication, session, MFA or RLS": it adds two owned tables with RLS, foreign keys between one user's rows, and guards that refuse an owner's own write. It extends [the portfolios model](2026-10-09-portfolio-setup.md), whose lock, stamp and write path it reuses.

## Scope and assets

- `public.holders`: names of people whose assets the user tracks, and whether each is archived.
- `public.source_connections`: the user's accounts, each an institution label, an optional holder, a default portfolio and whether it goes in the tax report. PLA-25's holdings will point at them.
- The invariant that an active account points at an active portfolio and holder of its own user.

Out of scope: holdings (PLA-25), which extend these guards to portfolios that still hold holdings.

## Trust boundary

The browser talks to PostgREST with the user's JWT (role `authenticated`) or without a session (`anon`). Everything the client sends is untrusted: ids, names, institutions, `holder_id`, `default_portfolio_id`, `include_in_tax_report`, `archived_at`, filters, and the `cuentas` and `titulares` params that page the archived lists.

## Data flow

1. The `/accounts` page reads the user's accounts with their holder and portfolio embedded through the composite foreign keys, and the user's holders and portfolios.
2. Its server actions create, edit, archive and restore holders and accounts through PostgREST with the user's JWT. Any client can also call PostgREST directly with its own token.
3. On every insert and update, the `portfolio_setup_*` triggers take the user's advisory lock, stamp `archived_at` and run the table's guard; the portfolio guard now also checks the accounts.

## Where it is enforced

- RLS `holders_owner` and `source_connections_owner`: `user_id = (select auth.uid())` in `USING` and `WITH CHECK`, plus the restrictive MFA gate.
- Column grants: `authenticated` inserts a holder's `name` and updates `name` and `archived_at`; inserts an account's `institution`, `holder_id`, `include_in_tax_report` and `default_portfolio_id` and updates those and `archived_at`. Never `user_id` or `id`; no API role holds `DELETE`; `anon` and `service_role` hold nothing.
- Foreign keys `(user_id, default_portfolio_id)` and `(user_id, holder_id)` to `UNIQUE (user_id, id)`: an account can only point at its own user's rows, and another user's id fails like a random one (`23503`, no hint).
- CHECK: holder names of 1 to 80 characters, institutions of 1 to 60, with no outer spaces; a unique index on `(user_id, lower(name))` among active holders.
- Guards (`SECURITY INVOKER`, `search_path = ''`, not executable by the API roles), keyed on the row's `user_id`: archiving a portfolio or holder an active account uses, and an active account on an archived portfolio or holder, are refused with `PT409` and a hint. A row the guard cannot find is left to the foreign key, so the guard never tells another user's id from a random one.
- The page: each cursor is parsed to one timestamp and one uuid before it reaches a filter.
- Server actions: `getSessionClaims()`, zod on every argument (uuids, a required holder of `"self"` or a uuid, a boolean, normalized names), filters by the session's `user_id` and the id besides RLS, and one log line without names, institutions or PostgREST's text.

## STRIDE

|       | Vector                                                                         | Control                                                                                                         |
| ----- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| **S** | Creating a holder or account in another user's name                            | No grant on `user_id`; `WITH CHECK` against `auth.uid()`                                                        |
| **T** | Editing, archiving or deleting another user's holder or account                | `USING` by `user_id` filters the update to nothing; no `DELETE` grant                                           |
| **T** | Pointing one's account at another user's portfolio or holder                   | Composite foreign keys to the user's own rows                                                                   |
| **R** | Not knowing when a holder or account was archived                              | `archived_at` is stamped by the database                                                                        |
| **I** | Reading another user's holders or accounts, or probing their ids through a key | RLS by `user_id`; the foreign key answers the same for another user's id and a random one; no upsert over an id |
| **D** | Archiving a portfolio or holder out from under active accounts                 | The guards, serialized by the per-user lock                                                                     |
| **E** | A guard used to read another user's rows                                       | Guards key on the written row's `user_id` and run as the caller, in `private`, not executable by the API roles  |

## Controls as built

- **pgTAP** (`supabase/tests/holders_accounts_isolation_test.sql`): the exact grants of both tables, the trigger definitions and order, the guards' settings, the CHECKs, unique index and foreign keys, the lock trigger on insert and update and the lock held after an insert, isolation between two users row by row, every guard and its hint, the last-portfolio check before the accounts check, the foreign key refusing another user's active and archived rows and a random id with no hint, the guards keying on the row's user past RLS, the policies refusing a move or takeover with the grants widened, and the cascade on account deletion. A guard reading `auth.uid()` turns six of them red.
- **PostgREST** (`security-tests/src/{holders,source-connections}.pentest.test.ts`): the shared cross-user cases, PATCHes and archives of another user's rows that change nothing, an account pointing at another user's holder or portfolio (409, `23503`, no hint), `holder_in_use`, `holder_archived`, `portfolio_in_use` and `portfolio_archived` over HTTP on create, restore and re-point, the foreign key refusing another user's archived portfolio, `DELETE` and the server's columns refused.
- **Server actions and page** (`actions.test.ts`, `read.test.ts`, `schemas.test.ts`): the filters, the required holder, an edit that never writes `archived_at`, a restore that clears it, every hint's mapping, and the embedded rows' mapping.

## Residual risk

- **The in-use alert names only the accounts the page shows**, up to 300 active ones; past that the alert may list fewer than there are.
- The portfolios model's residual risks hold here too.
