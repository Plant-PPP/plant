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
