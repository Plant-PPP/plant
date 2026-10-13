# Threat model: following imports over Realtime

Branch `feat/pla-40-live-upload-status` (PLA-40). The PR template requires it for a trust boundary change: `public.imports` joins the `supabase_realtime` publication, so its rows now leave the database through Realtime's socket as well as PostgREST.

## Scope and assets

- **What it protects:** each user's `imports` rows (id, document, status, failure, dates and the totals the document prints), now sent over Realtime.
- **Left out:** the files and their drafts, which are not published; the review (PLA-80).

## Trust boundary

- **The browser** opens a Realtime channel with the session's token and asks for changes on `public.imports`. Anyone holding the public anon key, or any signed-in user, can open their own channel with any filter or none.

## Data flow

1. Cargar (`components/imports/upload-imports.tsx`) opens a channel while one of the user's imports is queued or being read, filtered on its `user_id`, and closes it once none is.
2. The job writes an import's status as `service_role`; the user's upload inserts the import.
3. Realtime reads the change from the publication's slot and runs `realtime.apply_rls` for each subscription to the table: it checks the subscriber's column grants, then RLS with the subscriber's claims, and sends the row only where both pass.
4. The page treats the event as a signal and reads its imports again on the server.

## Where it is enforced

- **The publication:** exactly `public.imports`, inserts and updates only. Realtime checks no grant or policy on a delete and would send its primary key to every subscriber of the table, so deletes are not published.
- **RLS and grants:** `imports_owner` and the MFA gate decide what a subscriber receives, as they do for PostgREST. A session below aal2 for a user with TOTP has the `authenticated_aal1` role, with no grant, so Realtime answers it with a 401 before RLS.
- **The filter** only narrows what Cargar asks for; it is not a boundary.

## STRIDE

|       | Vector                                  | Control                                                                                                                                                                                                                                                             |
| ----- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **S** | A channel joined as another user        | Realtime takes the claims from the JWT the channel joins with; Cargar sets the session's token before joining; if fetching the session fails, the channel joins with the token Realtime already holds (the same user's earlier one, or none: anon, with only 401s). |
| **T** | Writing through the channel             | postgres_changes only reads; writes still go through PostgREST and its grants.                                                                                                                                                                                      |
| **R** | —                                       | Nothing is written through Realtime.                                                                                                                                                                                                                                |
| **I** | Another user's import rows or deletions | `apply_rls` with the owner policy and the MFA gate on inserts and updates; deletes are not published.                                                                                                                                                               |
| **D** | Many channels or changes                | Cargar opens one channel per tab only while an import is in flight; the monthly quota bounds the changes.                                                                                                                                                           |
| **E** | An aal1 session reading over the socket | `authenticated_aal1` holds no grant, so every change reaches it as a 401 with no record.                                                                                                                                                                            |

## Controls as built

- **What is published:** `supabase/tests/schema_rls_and_grants_test.sql` pins the publication to `public.imports`, its operations to inserts and updates, and the table's default replica identity.
- **Another user's rows never arrive:** `security-tests/src/imports-realtime.pentest.test.ts` subscribes with no filter and checks every event belongs to the subscriber; it fails with RLS off on `imports`.
- **The aal1 role has no grant:** `supabase/tests/mfa_gate_test.sql`, `schema_rls_and_grants_test.sql` and `security-tests/src/mfa.pentest.test.ts`.

## Residual risk

- **A subscriber without a grant learns when any user's import changes**: anon and aal1 channels get a 401 event, with no record, for every insert or update on the table. Only the timing leaks; no publication setting removes it short of not publishing.
- **The publication can drift on the hosted project**: its operations can be toggled in the dashboard, which pgTAP does not see. They are never changed there.
- **The app records no failure to subscribe** until browser error reporting (PLA-88): a join the server refuses shows in Supabase's Realtime logs, a timeout or a socket that never connects nowhere. realtime-js keeps rejoining and each rejoin catches up.
