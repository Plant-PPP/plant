# Threat model: uploads with no account

Branch `feat/uploads-without-account`. Required by the "Change in authentication, session, MFA or RLS" trigger: `authenticated` gains `UPDATE (source_connection_id)` on `uploaded_documents`.

## Scope and assets

The link between an uploaded document and the account its holdings or operations are written into. Left out: the file itself, its reading and the drafts, which are unchanged (see `2026-10-14-uploads-and-reading.md`).

## Trust boundary

The browser sends an optional account id with an upload, and an import id plus an account id when the review asks for one. Both are untrusted.

## Data flow

1. `startUpload` / `finishUpload` (`apps/web/src/lib/imports/write.ts`) take `accountId` or `null`; an id must be one of the user's open accounts.
2. The document row is inserted under RLS with that account or none; the job reads it with no institution.
3. A card statement's debts confirm as before. Holdings or operations of a document with no account render the account choice; `assignImportAccount` sets the account under RLS, and only then does the usual review and `confirm_import` run.

## Where it is enforced

- RLS `uploaded_documents_owner` (`FOR ALL`, `USING` and `WITH CHECK` on `user_id`) and the MFA gate apply to the new UPDATE.
- The column grant covers only `source_connection_id`.
- The composite FK `(user_id, source_connection_id)` holds the account to the document's user.
- Trigger `uploaded_documents_account_set_once` refuses changing an account once set, or clearing it (42501).
- `readyImport` refuses confirming holdings or operations of a document with no account.

## STRIDE

|       | Vector                 | Control                                                                          |
| ----- | ---------------------- | -------------------------------------------------------------------------------- |
| **S** | Spoofing               | Session claims; RLS on `auth.uid()`.                                             |
| **T** | Tampering              | A user points their document at another user's account                           | Composite FK (23503); pgTAP and pentest spec.          |
| **T** | Tampering              | A user moves a confirmed document to another account to rewrite history          | Set-once trigger (42501); pgTAP and pentest spec.      |
| **R** | Repudiation            | `imports.upload` logs the `account` step with its outcome.                       |
| **I** | Information disclosure | Another user's document                                                          | RLS; PATCH of B's rows changes nothing (pentest spec). |
| **D** | Denial of service      | Uploads with no account count against the same monthly quota.                    |
| **E** | Elevation of privilege | Column grant only on `source_connection_id`; no grant on `user_id` (floor test). |

## Controls as built

- **Set once**: `supabase/tests/uploads_without_account_test.sql`.
- **Grants**: `supabase/tests/uploads_isolation_test.sql` pins the new column grant.
- **Another user**: `security-tests/src/uploaded-documents.pentest.test.ts`.
- **Review routing**: `apps/web/src/app/(app)/(data)/import/review-view.test.tsx`.

## Residual risk

A user can set one of their own archived accounts through the API directly: the server action checks the account is open, the database does not. It reaches only the user's own data, so it is accepted.
