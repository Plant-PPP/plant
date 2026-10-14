# Threat model: the import job

> **Superseded by [2026-10-14-uploads-and-reading.md](2026-10-14-uploads-and-reading.md).** CSV and Excel are read in code (PLA-38), the quota is enforced (PLA-42) and the job runs on a deployment behind `PLANT_RUN_JOBS` (PLA-73).

Branch `feat/pla-35-import-job` (PLA-35). The PR template requires it for a new use of an AI provider on user data, a service-role path and new grants: the job reads every user's uploaded statements past RLS and sends them to Gemini.

## Scope and assets

- **What it protects:** each user's uploaded statements, the draft the job reads from them (`import_items`), and their imports' status, failure and document date.
- **Left out:** the review and confirmation of a draft (PLA-80, PLA-41), the pre-analysis and consensus (PLA-36, PLA-37), CSV and Excel (PLA-38), and running the job on a deployment, which waits on PLA-73's Inngest and secret-key setup.

## Trust boundary

- **The event** (`plant/import.requested`) names an import and a user. `finishUpload` sends it with the session's user, but the job trusts neither: anyone who could send an event could name any id.
- **The file** is untrusted content the model reads: it may carry text written to steer the model.
- **The model's answer** is untrusted output: every row is checked against the draft's schema before it is saved.

## Data flow

1. `finishUpload` files the document and its queued import, then sends the event; a failed send leaves the import queued and is logged.
2. The job's `prepare` step loads the import with the service role, checks it belongs to the event's user, is queued (or reading, on a retry) and that its file sits under that user's folder, then marks it reading.
3. The `read` step downloads the file, sends it to Gemini (`gemini-3.8-flash`) through the cost middleware, which bills the call to the import's user, checks each row, replaces any earlier draft and marks the import ready with its document date.
4. A reading that a retry would not pass, or one past its retries, marks the import failed with its reason.

## Where it is enforced

- **The sink's fence:** only the Inngest route imports `import-sink.ts`, the only new holder of the service-role client (ESLint, `scripts/web-import-fences.test.mjs`).
- **Grants:** the service role reads only an import's id, user, file and status and a file's id, user, path and type; updates only an import's status, failure and date; and writes and deletes only draft rows. pgTAP pins them. `authenticated` only reads a draft.
- **The job's checks:** the import's owner against the event's user, its status, and its path's prefix.
- **The model's prompt:** the document is data; it never outputs an identity number, account number, name or address. The schema has no field for them, and a row with an extra field is refused.
- **Steps carry no content:** a step returns ids, counts and codes; the file and the draft never cross a step boundary, so Inngest stores neither.

## STRIDE

|       | Vector                                        | Control                                                                                                                            |
| ----- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **S** | An event naming another user's import         | `prepare` skips an import whose owner is not the event's user, and the event is signed with the event key outside dev.             |
| **T** | A file steering the model into other rows     | Only the user's own draft is written, and the user reviews it before anything is saved to their holdings.                          |
| **R** | A user denies an import                       | `imports.read` logs each run with the import's id, the user and the outcome.                                                       |
| **I** | A file's contents or identity numbers leaking | Logs carry ids, counts and codes, never the file or a row; the prompt and schema leave identity numbers out; Gemini gets the file. |
| **D** | Many or large files                           | One import at a time per user (`concurrency`), 20 MiB per file, three retries; the monthly quota arrives with PLA-42.              |
| **E** | The service role reaching more than a draft   | Column grants, pinned by pgTAP; the sink only filters by the import's id; the fence keeps the client in the Inngest route.         |

## Controls as built

- **Grants and isolation:** `supabase/tests/import_items_isolation_test.sql` and `security-tests/src/import-items.pentest.test.ts`.
- **The job's checks:** `packages/jobs/src/functions/import-document.test.ts`.
- **The extractor:** `apps/web/src/lib/ai/document-extractor.test.ts` (rows checked, cost billed, a spreadsheet never sent).
- **The fence:** `scripts/web-import-fences.test.mjs`.

## Residual risk

- **Gemini receives the user's statement**, which can carry identity numbers the model is told to ignore. The terms the user accepted name the AI providers; the API's terms keep the data out of training.
- **A draft can hold rows the document does not**, if the model misreads it or the file steers it. The draft only reaches the user's holdings through their review.
