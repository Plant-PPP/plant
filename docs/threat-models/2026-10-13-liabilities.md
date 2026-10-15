# Threat model: liabilities

Branch `feat/pla-77-debts` (PLA-77, PLA-31). The PR template requires it for a change in RLS and a new field with financial data: every debt carries its balance, installment and rate.

## Scope and assets

- **What it protects:** each user's debts: kind, label, lender, unit, balance, installment, rate, installments left and dates.
- **Left out:** linking a property to the debt that paid for it, and importing debts from documents.

## Trust boundary

- **The user's own input** reaches PostgREST directly, through the table's column grants; the Deudas page's server actions use the same API. Everything a request carries is untrusted: the id (another user's debt) and every field.

## Data flow

1. The browser calls a server action in `apps/web` (`app/(app)/(data)/debts/actions.ts`), which validates the debt with core's `liabilityInputSchema` and writes it with the session's token. Or an attacker calls PostgREST directly with their own token.
2. PostgREST writes `public.liabilities` as `authenticated`, with RLS on.
3. The page reads the user's debts and values them with core at the stored quotes.

## Where it is enforced

- **RLS:** the owner predicate in `USING` and `WITH CHECK`, and the MFA gate.
- **Column grants:** `authenticated` never writes `user_id`, `id`, `created_at` or `updated_at`; it deletes, since a debt is never archived.
- **CHECKs:** core's unit rule (`liabilities_unit`), a balance above zero, the rate's and dates' bounds, and the label's length.

## STRIDE

|       | Vector                                  | Control                                                                                                                              |
| ----- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **S** | A request acts as another user          | The JWT's `sub` is `auth.uid()`; the policy filters by it, and `user_id` defaults to it with no write grant.                         |
| **T** | Writing or deleting another user's debt | RLS leaves another user's rows out of every update and delete; the write answers `not_found`. pgTAP and the pentest spec cover both. |
| **R** | A user denies a write                   | Not covered: `audit_log` records auth events only. Accepted for the beta, since a user only changes their own data.                  |
| **I** | Reading another user's debts            | RLS returns nothing; logs carry ids, counts and outcomes, never an amount or a label (`liabilities.write`, `liabilities.view`).      |
| **D** | Many debts                              | The page reads at most `PAGE_ROW_LIMIT` and says when it cut the list.                                                               |
| **E** | A column grant past the owner           | No grant on `user_id`; the pgTAP ACL test pins every column grant.                                                                   |

## Controls as built

- **Owner isolation and the grants:** `supabase/tests/liabilities_isolation_test.sql` and `security-tests/src/liabilities.pentest.test.ts`.
- **The unit rule:** the same pgTAP file, a case per kind.
- **Logs without values:** `lib/debts/write.test.ts` and the page's test check no amount reaches a log line.

## Residual risk

- **A user can store a debt core would refuse in its fields** (a rate the CHECK takes but the form does not), straight through the API. Only their own page suffers, which parses each row before use.

## Debts with a history (PLA-163)

- **New surface:** `liability_events` and `liability_collateral` (owned tables, composite foreign keys to the user's debts and holdings, RLS and the MFA gate), and the INVOKER RPCs `record_liability_event`, `update_liability_event`, `delete_liability_event`, `move_cash` and `restore_cash`, each deriving the user from `auth.uid()`, taking the user's advisory lock first and pinning `user_id` in every predicate.
- **Events only through the RPCs:** `private.written_through('plant.liability_event')` refuses any direct write by `authenticated` unless the RPC turned its setting on for its own write; a cascade runs as the owner. PostgREST cannot set the setting.
- **Cash:** `move_cash` and `restore_cash` change only the caller's cash holdings, a power the holdings' `UPDATE (amount, archived_at)` grant already gives. The currency comes from the debt row, never the payload; an event's payload cannot name a holding. When the holding was archived, `restore_cash` credits only the caller's active cash of the same account, portfolio and currency, and an edit that keeps the link moves it to that holding.
- **Lock order:** the user's advisory lock first, then the debt, then the event, then the cash holding. Archiving a cash holding by hand takes its row before the trigger's advisory lock, so a race with a payment can deadlock (40P01), which the app reads as try again.
- **Controls as built:** `supabase/tests/liability_events_isolation_test.sql` and `liability_rpcs_test.sql` (seen failing with the trigger, the composite foreign key and the event guard removed), and `security-tests/src/{liability-events,liability-collateral,liability-event-rpcs,cash-moves}.pentest.test.ts`.
- **Residual risk:** deleting a debt or a cash holding drops the cash link without giving cash back; only the user's own figures move.
