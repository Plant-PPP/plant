# Threat model: the import quota and deleting uploaded files

> **Superseded by [2026-10-14-uploads-and-reading.md](2026-10-14-uploads-and-reading.md).** The quota now counts `private.import_requests`, not live imports, and the deletion job runs on a deployment behind `PLANT_RUN_JOBS` (PLA-73).

Branch `feat/pla-42-quota-and-file-deletion` (PLA-42, PLA-43). The PR template requires it for a change in grants and a new job: `service_role` gets to read when a file is due and mark it deleted, and a new Inngest function removes files across every user.

## Scope and assets

- **What it protects:** each user's uploaded statements in Storage, which hold personal and financial data, and the AI spend an import costs.
- **Left out:** quotas on the assistant (they arrive with its stage) and paid plans.

## Trust boundary

- **The upload actions** run with the user's token; a user can also insert into `imports` directly with it.
- **The deletion job** runs with the service role, past RLS and Storage's policies, on a cron schedule; no request reaches it.

## Data flow

1. `startUpload` counts the user's imports this month and refuses past 20 before signing a URL.
2. `finishUpload` inserts the import; `private.check_import_quota` counts again under a per-user lock and refuses the 21st with `PT429`. The action then deletes the document and removes the file.
3. Once a day `delete-expired-files` reads up to 100 documents whose `delete_after` passed and whose file is still there, removes their files from the uploads bucket and sets `file_deleted_at`; it repeats while batches come back full, at most 20 times a run.
4. `private.record_file_deletion` writes an `imports.file.deleted` audit row for each document marked.

## Where it is enforced

- **The quota trigger:** a `BEFORE INSERT` trigger on `imports`, whatever the caller; the advisory lock keeps two inserts at once from both taking the last one.
- **The grants:** `service_role` reads `delete_after` and `file_deleted_at` and updates only `file_deleted_at`; `authenticated` holds neither.
- **The fence:** the deletion store's sink sits in `import-sink.ts`, which only the Inngest route may import.

## STRIDE

|       | Vector                                   | Control                                                                                                       |
| ----- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **S** | A user marking a file deleted to keep it | `authenticated` cannot update `file_deleted_at` (pgTAP).                                                      |
| **T** | The job extending a file's life          | `service_role` cannot update `delete_after` (pgTAP).                                                          |
| **R** | A deletion nobody can trace              | The trigger writes one audit row per file, with the document's id; the job logs each run's count and outcome. |
| **I** | Paths or file names in logs              | The job and the store log counts, outcomes and error codes only; the store keeps no error details.            |
| **D** | Uploading past the month's quota         | The trigger refuses the 21st import whatever the client does; a concurrent pair waits on the user's lock.     |
| **D** | One user's quota blocking another        | The count and the lock are per user (pgTAP).                                                                  |
| **E** | The job removing a file that is not due  | It reads only rows past `delete_after` with no `file_deleted_at`, and removes only the paths those rows hold. |

## Controls as built

- **The quota and the grants:** `supabase/tests/import_quota_test.sql`, `supabase/tests/import_items_isolation_test.sql`, `supabase/tests/schema_rls_and_grants_test.sql`.
- **The job and its store:** `packages/jobs/src/functions/delete-expired-files.test.ts`, `apps/web/src/lib/imports/file-deletion-store.test.ts`.
- **The actions:** `apps/web/src/lib/imports/write.test.ts`.

## Residual risk

- **The job runs only under `next dev`** until PLA-73 registers it on a deployment, so until then a file outlives its `delete_after` on staging.
- **A file removed but not marked** (the mark fails after the removal) is removed again on the next run, which succeeds for a path already gone.
