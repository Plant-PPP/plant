# Threat model: uploading and reading statements

Branch `docs/pla-46-uploads-threat-model` (PLA-46). One model of the whole flow, from the upload to the confirmed import, as built on `staging` after PLA-34, PLA-35, PLA-38, PLA-41, PLA-42, PLA-43, PLA-73, PLA-80, PLA-81, PLA-99 and PLA-138. It replaces the stale parts of `2026-10-13-uploads.md`, `2026-10-13-import-job.md` and `2026-10-13-quota-and-file-deletion.md`; `2026-10-13-confirm-import.md` and `2026-10-13-imports-realtime.md` still hold for their pieces.

## Scope and assets

- **What it protects:** each user's uploaded files in the private `imports` bucket (statements, screenshots and spreadsheets with holdings and possibly DNI, CUIT, CBU, names and addresses); their rows in `uploaded_documents`, `imports`, `import_items` and `column_mappings`; the holdings and movements a confirmed import writes; and the AI spend an import costs.
- **Left out:** the review UI's rendering (React escapes every string), the assistant's other tools (`2026-10-13-assistant-chat.md`), Realtime (`2026-10-13-imports-realtime.md`) and deleting the Auth user, which is not built yet (PLA-84; see Open risks).

## Trust boundary

- **The browser:** every field of `startUpload`, `finishUpload` and `confirmImport` (file name, size, account, upload id, path, reviewed rows), the bytes it puts at the signed URL, and any call it makes straight to PostgREST or Storage with the user's token.
- **The file's content:** untrusted bytes parsed by SheetJS and read by Gemini; it may carry text written to steer the model, or a structure built to exhaust the parser.
- **The model's answers:** the extraction and the column mapping are untrusted output, checked against a schema before anything is saved.
- **The Inngest event** `plant/import.requested`: it names an import and a user, and the job trusts neither.
- **Gemini (Google):** an external processor that receives the whole file, or a spreadsheet's headers and five sample rows.

## Data flow

1. **Start.** `startUpload` (`apps/web/src/lib/imports/write.ts`) cleans the name (`cleanFileName`), takes the type from its extension (`uploadTypeOf`), checks the declared size (1 B to 20 MiB), the terms in force, that the account is one of the user's open ones and the month's count, then mints `{user_id}/imports/{upload_id}/{object_id}` from two random UUIDs and asks Storage for a signed upload URL with the session's client.
2. **Upload.** The browser puts the file at that URL, as the type its name says. The bucket refuses more than 20 MiB or a content type off its list.
3. **Finish.** `finishUpload` checks the path against the session's user and the upload id (`uploadPathProblem`: four segments, owner, `imports`, both UUIDs), the terms and the account again, downloads the file with the session's client, checks the real size and the first bytes against the type (`bytesMatch`), hashes it, handles a re-upload (step 4), files `uploaded_documents` and a queued `imports` row, and sends the event with idempotency id `import-{importId}` (`packages/jobs/src/job-runner.ts`). Any refusal removes the file.
4. **Re-upload of the same file to the same account** (same SHA-256): an earlier one that cannot be read (no import, `failed`, or `queued` with its file expired) is deleted with its import and file, and the new one is filed as a new import, which the quota counts; an earlier one still `queued` is started again under the same event id and the new upload's file is removed; any other answers `duplicate`.
5. **Quota.** `private.check_import_quota`, a `SECURITY DEFINER` `BEFORE INSERT` trigger on `imports`, takes a per-user advisory lock, counts `private.import_requests` for the calendar month in Buenos Aires, refuses the 21st with `PT429`, and records the request. Deleting a document does not give an import back.
6. **Prepare.** `import-document` (`packages/jobs/src/functions/import-document.ts`, one run at a time per user, 3 retries) loads the import with the service role filtered by id and user, skips it unless it is that user's, `queued` or `reading`, and its path starts with `{user_id}/imports/`, then marks it `reading`.
7. **Read.** The `read` step downloads the file and hands it to the reader for its stored type (`read-document.ts`):
   - **PDF and pictures:** the whole file goes to `gemini-3.8-flash` (`document-extractor.ts`) with a system prompt that treats the document as data and forbids identity and account numbers, names and addresses; the answer is a schema with no field for them, at most 500 rows, and each row is checked again against `draftRowSchema`, a failing row left out.
   - **CSV, XLS, XLSX:** parsed in code by SheetJS 0.20.3 (`packages/sources/src/file-upload/spreadsheet.ts`): first sheet only, at most 520 rows and 50 columns, no formulas, HTML or styles; a CSV that is not valid UTF-8 is decoded as Windows-1252; a header over 80 characters or across lines is refused. The column mapping comes from `column_mappings` (per user, account institution and SHA-256 of the headers) or, on a miss, from one model call (`column-mapper.ts`) that sees the headers and five rows, each cell passed through `neutralizePromptText` and cut to 80 characters, and whose schema accepts only headers the sheet has. The mapping is saved only when its reading looks right (`spreadsheet-reader.ts`).
   - Both model calls go through `structuredCall` (`apps/web/src/lib/ai/structured-call.ts`): billed to the import's user in `ai_costs`, 1 SDK retry, a timeout (120 s, 60 s), telemetry without inputs or outputs.
8. **Save.** `saveDraft` (`import-store.ts`) writes only while the import is `queued` or `reading`: it replaces the draft, stores the document date and printed totals, and marks it `ready`. A failure that a retry would not pass, or one past the retries, marks it `failed` with its code (`failureOf`); a run that dies past its retries is failed by `onFailure` (`failAbandonedImport`).
9. **Review and confirm.** The review reads the draft through RLS and runs core's checks on the rows as they stand. `confirmImport` (`confirm-write.ts`) re-reads the import (the user's, `ready`), builds at most 500 operations and calls `confirm_import`, `SECURITY INVOKER`, which marks it confirmed and writes each operation through `write_operation` in one transaction; a statement older than a later balance answers `opens_later`.
10. **Expiry.** `delete-expired-files` (daily cron, 100 per batch, at most 20 batches) removes files whose `delete_after` (upload + 30 days) has passed and sets `file_deleted_at`; `private.record_file_deletion` writes an `imports.file.deleted` audit row. The rows, the import and the draft stay.
    **Orphans.** `delete-orphan-files` (daily cron, 100 per batch, at most 20 batches) removes objects of the bucket over a day old that no `uploaded_documents.storage_path` names, which `public.orphan_import_files` lists by object id for the service role only.
11. **Deleting a Plant account** (`deleteSourceConnection`, `apps/web/src/lib/portfolio-setup/account-uploads.ts`): refused while a holding sits in it; otherwise its files are removed as the user first, and a file that cannot be removed keeps the account. The rows cascade; `import_requests` keeps counting.
12. **The assistant's `getImportStatus`** (`apps/web/src/lib/assistant/tools-data.ts`) reads Cargar's list through the session's client: file name (neutralized, 80 characters), status label, failure, document date, upload date and the month's count. It takes no user id.

Steps 6 to 10, orphans included, run on a deployment only where `PLANT_RUN_JOBS=1` (PLA-73), with the service-role key beside it.

## Where it is enforced

- **Storage policies** (`supabase/migrations/20261013135000_uploads.sql`): insert, select and delete only under `{auth.uid()}/imports/`; no update policy, so a hashed file is never overwritten; the MFA gate as a RESTRICTIVE policy on `storage.objects`. The bucket is private, 20 MiB, with a content-type list.
- **Table CHECKs:** the path is `uuid/imports/uuid/uuid` with the owner's id first, the type on the list, size 1 B to 20 MiB, hash 64 hex, name 1 to 255 characters with no control character or slash; one file per account by hash.
- **RLS and grants:** owner predicate and MFA gate on `uploaded_documents`, `imports`, `import_items`, `column_mappings`. `authenticated` inserts only a document's file columns and an import's `document_id`, deletes its documents, updates only `imports.status`, and only reads drafts and mappings. `service_role` holds column grants for exactly what the job and the deletion job read and write, never `delete_after`. `private.import_requests` has no grant to any API role.
- **Triggers:** `check_import_quota` (quota, whatever the caller); `guard_import_status` (a user moves only `ready` to `confirmed`; nobody moves out of `confirmed`).
- **Server checks:** `admitted`, `uploadPathProblem` and `bytesMatch` in `write.ts`; the job's owner, status and path checks; `saveDraft` and `failed` only while being read.
- **Fence:** only `/api/inngest` imports `import-sink.ts`, the only holder of the service-role client for imports, mappings, file deletion and orphan files (`scripts/web-import-fences.test.mjs`).
- **Prompts and schemas:** the document and the sheet are data; the extraction schema has no identity field; the mapping schema names only the sheet's headers; the extraction has no tools.

## STRIDE

|       | Vector                                                         | Control                                                                                                                                                                                                     |
| ----- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **S** | A request or event acting as another user                      | `auth.uid()` from the JWT drives Storage policies and RLS; `user_id` has no write grant. The job loads the import by id and user and skips a mismatch; events are signed outside dev.                       |
| **S** | A replayed signed Inngest body sent to another function        | Every job re-checks its input against the database: `import-document` reads only a `queued` or `reading` import of the event's user; `delete-expired-files` removes only due files.                         |
| **T** | Path traversal or a file in another user's folder              | The server mints the path; `uploadPathProblem` and the path CHECK accept only four UUID segments under the owner; the insert policy checks the folder; the job checks the prefix again.                     |
| **T** | A file swapped after it was checked                            | No Storage update policy; a re-upload to the same path is refused by Storage (no upsert).                                                                                                                   |
| **T** | A malicious file disguised by extension or content type        | The type comes from the name and is checked against the first bytes; the bucket refuses other content types; the stored type picks the reader, so a spreadsheet never reaches the model as a document.      |
| **T** | Prompt injection from the document or sheet                    | System prompt marks it as data; structured output with no tools; rows checked against the draft schema; sheet cells neutralized and cut; the user reviews every row before anything reaches their holdings. |
| **T** | A poisoned column mapping reused                               | Mappings are per user and institution, written only by the job, kept only when the reading looks right, and re-validated against the headers on every read.                                                 |
| **T** | A retried read rewriting a confirmed import                    | `saveDraft` writes only while `queued` or `reading`; `guard_import_status` refuses any move out of `confirmed`.                                                                                             |
| **T** | Confirming into another user's account, or an outdated balance | `confirm_import` runs as the caller and every operation goes through `write_operation` (owner, revisions, units never below zero); an older statement under a later balance answers `opens_later`.          |
| **R** | A user denies an upload, read, confirmation or deletion        | `imports.upload`, `imports.read` and `imports.confirm` log each step with the user and the outcome; each file deletion writes an audit row.                                                                 |
| **I** | Reading another user's files or rows                           | Private bucket, Storage policies and RLS; pgTAP and pentest specs cover every table.                                                                                                                        |
| **I** | Personal data sent to Gemini                                   | The user accepts the AI-providers consent before any upload; the prompt and schema keep identity numbers out of the draft; the API's terms keep the data out of training.                                   |
| **I** | Contents, file names or paths in logs or traces                | Logs carry ids, types, counts and codes; store errors keep only a step and a code; gen_ai spans record no inputs or outputs; steps return ids and counts, so Inngest stores neither the file nor the draft. |
| **I** | Files kept longer than promised                                | `delete-expired-files` removes them 30 days after upload; `delete-orphan-files` removes a file no document names a day after it was written; deleting a Plant account removes its files first.              |
| **D** | Many uploads or AI calls                                       | 20 imports a calendar month, counted in a ledger that deletions do not shrink, under a per-user lock; one read at a time per user; at most 4 attempts per import, each with 1 SDK retry and a timeout.      |
| **D** | Huge files or sheets                                           | 20 MiB in the bucket and the CHECK; SheetJS reads one sheet, 520 rows, 50 columns, no formulas; the model answers at most 500 rows; the review and the RPC take at most 500.                                |
| **E** | The service role reaching more than it needs                   | Column grants pinned by pgTAP; the sink filters by import id and user; the fence keeps the client in the Inngest route.                                                                                     |
| **E** | A user setting `ready`, `delete_after` or `file_deleted_at`    | No grant on those columns; `status` only from `ready` to `confirmed`.                                                                                                                                       |

## Controls as built

- **Storage policies, bucket, grants and CHECKs:** `supabase/tests/uploads_isolation_test.sql`, `supabase/tests/schema_rls_and_grants_test.sql`, `security-tests/src/uploaded-documents.pentest.test.ts`, `security-tests/src/imports.pentest.test.ts`.
- **Drafts and mappings:** `supabase/tests/import_items_isolation_test.sql`, `supabase/tests/column_mappings_isolation_test.sql`, `security-tests/src/import-items.pentest.test.ts`, `security-tests/src/column-mappings.pentest.test.ts`.
- **Quota ledger and status guard:** `supabase/tests/import_quota_test.sql`, `supabase/tests/confirm_import_test.sql`, `security-tests/src/confirm-import.pentest.test.ts`.
- **Type, path, re-upload and log checks:** `apps/web/src/lib/imports/upload.test.ts`, `apps/web/src/lib/imports/write.test.ts`.
- **The job:** `packages/jobs/src/functions/import-document.test.ts`, `apps/web/src/lib/imports/import-store.test.ts`, `apps/web/src/lib/imports/read-document.test.ts`.
- **Readers and model calls:** `packages/sources/src/file-upload/spreadsheet.test.ts`, `apps/web/src/lib/imports/spreadsheet-reader.test.ts`, `apps/web/src/lib/ai/document-extractor.test.ts`, `apps/web/src/lib/ai/column-mapper.test.ts`, `apps/web/src/lib/ai/structured-call.test.ts`.
- **Confirmation:** `apps/web/src/lib/imports/confirm-write.test.ts`, `apps/web/src/lib/imports/confirm.test.ts`.
- **File deletion:** `packages/jobs/src/functions/delete-expired-files.test.ts`, `apps/web/src/lib/imports/file-deletion-store.test.ts`, `apps/web/src/app/(app)/(data)/accounts/actions.test.ts`.
- **Orphan files:** `supabase/tests/orphan_import_files_test.sql`, `security-tests/src/orphan-import-files.pentest.test.ts`, `packages/jobs/src/functions/delete-orphan-files.test.ts`, `apps/web/src/lib/imports/orphan-file-store.test.ts`.
- **The fence:** `scripts/web-import-fences.test.mjs`.

## Residual risk

- **Gemini receives the whole statement**, identity numbers included. Accepted: the user consents to the AI providers, and the draft never stores those fields.
- **A draft can hold rows the document does not**, by misreading or injection, and the free-text `symbol` could carry text the model should have dropped. Accepted: it is the user's own draft, shown escaped, and reaches holdings only through their review.
- **The server holds a file of up to 20 MiB in memory** in `finishUpload` and in the job. Bounded by one read per user and the quota.
- **A user can file a document row straight through the API** with a hash, size or type that does not match their file. Only their own import suffers: the job reads the stored type and the file itself, and the readers reject what does not parse.
- **An orphan whose `finishUpload` runs over a day after its upload** can be removed while that call files its row, leaving a row with no file. Only the user's own import suffers: the job cannot download the file and fails it. The app finishes an upload right after it; a later call takes a crafted request.
- **A Plant account whose file Storage no longer has but whose row is not marked deleted** cannot be deleted (`storage_remove`) until the deletion job marks it. Rare; the job retries the mark on its next run.

## Open risks

Files with no document row are removed by `delete-orphan-files` (PLA-141; Data flow step 10).

Proposed issues, not yet created:

| Risk                                                                                                                                                                                                                                                                                                    | Proposed issue                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **Deleting the Auth user leaves the files in Storage until the next orphan run.** The rows cascade from `auth.users`, and `delete-orphan-files` removes the objects within a day, at most 2000 a run. The real account deletion (PLA-84) should still remove `{uid}/imports/` before deleting the user. | Add to PLA-84: "Borrar los archivos subidos al borrar la cuenta" |
| **A crafted XLSX can inflate far past 20 MiB.** SheetJS inflates the sheet's XML before `sheetRows` applies, so a ZIP bomb can exhaust the function's memory; the run dies, retries and ends failed. Bounded by the quota and one read per user, but it costs compute and retries.                      | "Limitar el tamaño descomprimido de los Excel antes de leerlos"  |
| **SheetJS is outside `pnpm audit`.** The pinned CDN tarball parses untrusted XLS and XLSX, and no automated check reports its advisories.                                                                                                                                                               | "Vigilar los avisos de seguridad de SheetJS"                     |
| **Cargar's pre-check and the month's count read live imports, not the ledger.** After deleting files, `startUpload`, Cargar and `getImportStatus` count fewer imports than the trigger does, so a user over the quota uploads the file before `finishUpload` refuses it and removes it.                 | "Contar las cargas del mes desde el registro de pedidos"         |
