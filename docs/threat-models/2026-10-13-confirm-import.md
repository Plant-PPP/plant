# Threat model: confirming an import

Branch `feat/pla-41-confirm-import` (PLA-41, PLA-80). The PR template requires it for a new endpoint and a change in grants: `confirm_import` is a new RPC, and `authenticated` gets to update an import's status.

## Scope and assets

- **What it protects:** each user's holdings and movements, which a confirmed import writes, and their imports' status.
- **Left out:** saving the review's edits before confirming; the review keeps them in the browser until the user confirms.

## Trust boundary

- **The review's rows** come from the browser: every symbol, quantity, price, portfolio and source account is untrusted. A user can also call `confirm_import` and PATCH `imports` directly with their own token.

## Data flow

1. The real review page reads the user's ready import, its draft and their ledger, and shows the draft beside what the account held at the document's date.
2. `confirmImport` (a server action) reads the import again (it must be the user's and ready), reads the ledger with the dollar rates of the document's date, and runs the prototype's `writeImport`: one operation per instrument that changes, admitted by the same code a movement typed by hand goes through.
3. It calls `confirm_import` with every operation's parts and the revisions it read. The RPC marks the import confirmed (only a ready import of the caller's) and writes each operation through `write_operation`, all in one transaction.

## Where it is enforced

- **`confirm_import`:** runs as the caller with an empty search path; `write_operation`'s own checks (owner, revisions, units never below zero) apply to every operation; a refused one rolls back the whole import.
- **The status grant:** `authenticated` may update only `imports.status`, and `private.guard_import_status` lets a user move an import only from ready to confirmed. The job moves it along every other step as `service_role`.
- **RLS:** the owner predicate and the MFA gate on `imports`, holdings and movements.

## STRIDE

|       | Vector                                     | Control                                                                                                        |
| ----- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| **S** | Confirming another user's import           | The RPC's update filters by `auth.uid()`; another user's import answers `not_found`, like one that is missing. |
| **T** | Writing into another user's account        | `write_operation` refuses another user's account or portfolio (its pentest spec); RLS bounds every write.      |
| **T** | Marking an import ready, or confirmed back | The trigger refuses any move but ready to confirmed; pgTAP covers both.                                        |
| **R** | A user denies a confirmation               | `imports.confirm` logs each one with the user, the operation count and the outcome.                            |
| **I** | Reading another user's draft or holdings   | RLS; logs carry counts and outcomes, never a symbol, quantity or price.                                        |
| **D** | A huge review                              | At most 500 rows in the action and 500 operations in the RPC; 20 parts per operation.                          |
| **E** | Confirming without the operations          | A user may mark their own ready import confirmed with no operations; only their own holdings miss the rows.    |

## Controls as built

- **The RPC and the trigger:** `supabase/tests/confirm_import_test.sql` and `security-tests/src/confirm-import.pentest.test.ts`.
- **The action:** `apps/web/src/lib/imports/confirm-write.test.ts`.

## Residual risk

- **A document dated before the stored dollar rates** cannot be confirmed: its operations need the rates of its date. The user can set the day's rate by hand (PLA-122).
