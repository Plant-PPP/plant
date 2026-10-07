# Threat model: profiles, consents and audit log

Branch `claude/project-thread-k27wk1` (PLA-16). Required by the trigger "Change in authentication, session, MFA or RLS": these are the first tables with user data and their RLS policies.

## Scope and assets

- `public.profiles`: display name and reference dollar (MEP or CCL). One row per user.
- `public.consents`: which version of the terms, the privacy policy and sending data to AI providers each user accepted or withdrew, and when. It is the proof of consent that Law 25.326 requires.
- `private.audit_log`: trail of sensitive actions (login, MFA, export, deletion, upload). No amounts, holdings, CUIT, DNI, CBU or tokens.

Out of scope: who writes the audit log (PLA-21) and login (PLA-17).

## Trust boundary

The browser talks to PostgREST with the user's JWT (role `authenticated`) or without a session (`anon`). Everything the client sends is untrusted: ids, columns and values.

## Data flow

1. On sign-up, the `on_auth_user_created` trigger creates the profile.
2. `apps/web` reads and edits the profile and records consents with supabase-js, as `authenticated`.
3. The server writes `audit_log` from PLA-21 on, outside the API.

## Where it is enforced

- RLS `user_id = (select auth.uid())` in `USING` and `WITH CHECK`.
- Column grants: the user only edits `display_name` and `reference_dollar`, and in `consents` only names `kind`, `version` and `granted`; `user_id` and `accepted_at` come from the defaults.
- `REVOKE ALL` from `anon` and `authenticated` before every grant, because with "auto expose" off TRUNCATE, REFERENCES, TRIGGER and MAINTAIN still remain by default.
- `audit_log` in the `private` schema, with no `USAGE` for the API roles and no privileges for `service_role`, and triggers that reject UPDATE, DELETE and TRUNCATE even for the owner.

## STRIDE

|       | Vector                                        | Control                                                                                                                    |
| ----- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **S** | Recording a consent in someone else's name    | `user_id` with no INSERT grant and `WITH CHECK` against `auth.uid()`                                                       |
| **T** | Editing or deleting a consent or an audit row | No UPDATE or DELETE on `consents`; append-only triggers on `audit_log`                                                     |
| **R** | Denying having accepted the terms             | Append-only `consents` with `accepted_at` set by the database                                                              |
| **I** | Reading someone else's profile or consents    | RLS by `user_id`; `anon` without privileges                                                                                |
| **D** | Huge texts in the profile or the version      | Length `CHECK` on `display_name`, `version`, `action` and `request_id`                                                     |
| **E** | Functions callable from the API               | Functions in `private`, no EXECUTE for `PUBLIC`, `anon` or `authenticated`; `SECURITY DEFINER` with an empty `search_path` |

## Controls as built

- **Schema floor** (`supabase/tests/schema_rls_and_grants_test.sql`), in the CI `database` job on every PR:
  - every table in `public` has RLS and a grant to `authenticated`; those in `private` have RLS and no grant to `anon` or `authenticated`;
  - every permissive policy in `public` is exactly `user_id = (select auth.uid())` for `authenticated`;
  - views with a grant run as the caller, and materialized views and foreign tables grant nothing;
  - an FK between owned tables pairs `user_id` with `user_id`;
  - `anon` has no privileges; no extensions are installed in `public` or `private`, and no function is executable by `anon` or `authenticated`;
  - the only `SECURITY DEFINER` function is the signup one; no other trigger on `public`, `private` or `auth` runs as its function's owner, and there are no rewrite rules in `public` or `private`;
  - only the owner holds TRUNCATE, TRIGGER, REFERENCES or MAINTAIN;
  - plpgsql_check finds no errors;
  - every table in `public` with a grant to `authenticated` has at least one policy;
  - every unique or exclusion key on an owned table has `user_id` as an equality column, or only columns the server generates;
  - on owned tables, `user_id` is NOT NULL and is deleted in cascade with the account, every uuid `*_id` column is its single-column primary key or a foreign key, there are no `uuid[]` columns, and no column comes from a sequence;
  - `authenticated` writes `public` tables only through column grants, never on `user_id`;
  - an FK from `public` to outside `public` can only be `user_id` → `auth.users`.

  The floor covers `public` and `private`. A new schema exposed through the API and the `storage.objects` policies (with file uploads) add their asserts in the PR that creates them.

- **Isolation** (`profiles_consents_isolation_test.sql`): another user can't read or write profiles or consents, or change the owner or the date. The policies are also tested with the `user_id` grant open, so `WITH CHECK` blocks the write on its own.
- **Audit** (`audit_log_test.sql`): no API role reads or writes it, and nobody modifies it while the triggers are active.

## Residual risk

- `audit_log` keeps the `user_id` after the account is deleted (no FK). It is an opaque id with no personal data; it is reviewed with the lawyer (PLA-56).
- Deleting the account deletes its `consents` history in cascade, which is the proof of what it accepted. How long it must be kept after the account is closed is reviewed with the lawyer (PLA-56).
- The table owner (`postgres`) can bypass the triggers from any session (`DISABLE TRIGGER` or `session_replication_role = replica`), with no trace in the migrations. Accepted: it is the same role that administers Supabase.
