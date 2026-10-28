# Threat model: exchange logs read whole, and the assistant's kept files

Branch `claude/optimistic-wozniak-5dq54g`. Required by the PR template: it changes RLS-adjacent grants and storage policies, keeps a user-controlled upload (the chat's files) that was not stored before, and lets a draft and an import name another account and a debt by id.

## Scope and assets

- The user's holdings and debts, which a confirmed import now changes in two new ways: units sent to another of their accounts, and payments recorded on a debt (taking the account's cash when the debt is in a currency).
- The files a user attaches to a question to the assistant: screenshots and PDFs of their accounts, now kept for 30 days in the `imports` bucket.
- Left out: the readers' prompts and the extraction itself, unchanged in trust (a document's text is still untrusted and goes through `prompt-text.ts`).

## Trust boundary

- The browser sends the reviewed rows of an import, including `counterpartId` and `payDebtId`, and the chat's files as data URLs. Neither is trusted.
- The model (assistant) names an account and a debt by name in `proposeOperations`; the server resolves them among the user's own.
- Storage paths kept in a question's metadata are written by the server, but read back on later turns.

## Data flow

1. Cargar: the import job (service role) writes a draft with `direction` and `debt_payment`; it cannot write `counterpart_connection_id` nor `pays_liability_id` (no column grant).
2. Review: the user picks the account a transfer goes to and the debt a payment pays; `confirmImportOperations` (`apps/web`) checks both against the user's own open accounts and debts read with the session's client, then calls `confirm_import` as the user.
3. `confirm_import` (INVOKER) checks every debt paid is the caller's and not a card, and records each payment through `record_liability_event` (INVOKER), under the debt guards.
4. Assistant: the chat route uploads the question's files with the session's client to `{uid}/assistant/{conversation}/`; a later turn downloads the latest set with the session's client after checking the path is the user's and the conversation's, and sends it to Anthropic.
5. A confirmed proposal calls `stage_assistant_import` (DEFINER), which refuses an account or debt that is not the caller's.

## Where it is enforced

- Composite foreign keys `(user_id, counterpart_connection_id)` and `(user_id, pays_liability_id)` on `import_operations`: a row never names another user's account or debt.
- Column grants: `service_role` inserts `direction` and `debt_payment` only.
- `confirm_import`: owner and not-a-card pre-check (`PT404 debt_not_found`); `record_liability_event` keeps its own owner check and guards.
- `stage_assistant_import`: explicit checks before inserting (`PT404 counterpart_not_found`, `PT404 debt_not_found`), with `SET search_path = ''`.
- Storage: `assistant_objects_{insert,select,delete}` limit `authenticated` to `bucket = imports`, first folder = `auth.uid()`, second = `assistant`; no update policy, so no overwrite; the MFA gate stays the only restrictive policy.
- Route/turn: `isAttachmentOf` before every download; at most four files and 4 MB read back.

## STRIDE

|       | Vector                                                                                         | Control                                                                                                                             |
| ----- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **S** | A request names another user's account or debt as a transfer's counterpart or a payment's debt | Composite FKs, `confirm_import` pre-check, `stage_assistant_import` checks; the server resolves names among the session user's rows |
| **T** | A crafted review payload pays a card, or takes cash the review did not read                    | Card refused in TS and SQL; cash taken against the expected amount (`PT409 stale`), chained across the import's payments            |
| **R** | A payment or transfer with no trace                                                            | `imports.confirm` counts transfers, units out and payments; `assistant.proposal` logs the staging's code and hint                   |
| **I** | A user reads another user's chat files                                                         | Storage policies by folder; replay only from the user's own path of the conversation; files read with the session's client          |
| **D** | Large or many chat files replayed every turn                                                   | One question's set, at most four files and 4 MB, per-file timeout within the turn's time                                            |
| **E** | The job writes a counterpart or a debt id                                                      | No column grant to `service_role` for either                                                                                        |

## Controls as built

- **Owner of a payment's debt**: `supabase/tests/import_debt_payments_test.sql` (another user's debt and a card → `PT404 debt_not_found`; a refused payment leaves the import ready).
- **Staging names only the caller's rows**: `supabase/tests/stage_assistant_import_test.sql` (another user's account, the import's own, an archived one; another user's debt, a card) and `security-tests/src/stage-assistant-import.pentest.test.ts`.
- **Draft columns**: `import_operation_outflows_test.sql`, `import_debt_payments_test.sql` (23503 for another user's account or debt; service role grants).
- **Chat files**: `uploads_isolation_test.sql` (own folder only), `schema_rls_and_grants_test.sql` (policy floor), `orphan_import_files_test.sql` (30-day retention), `turn-files.test.ts` (path checked before download).

## Residual risk

- An unnumbered operation or payment confirmed from two reviews at once is written twice; the review sets each aside when already loaded, as for any unnumbered operation. Revisit if it shows in support.
- A user can write arbitrary files of the bucket's allowed types into their own `assistant/` folder; they cost storage only to that user and go after 30 days.
