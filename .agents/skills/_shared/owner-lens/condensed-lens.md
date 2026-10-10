# Condensed owner-isolation lens (paste verbatim per subagent)

This is the block review/planning skills paste into every subagent prompt (a "see the skill"
reference is inert; subagents inherit only their prompt). The fat `enforce-owner-isolation/SKILL.md`
(the house-form migration, full severity table) is the orchestrator's Read. Unlike the other lenses
this one is CONDITIONAL — a no-op on a diff with no DB or authz surface.

```
=== OWNER-ISOLATION LENS (attack every DB/authz change for a cross-user path) ===
On its own `owner-lens loaded:`-prefixed line in the load-proof HEADER BLOCK (header order: catalog,
ports-lens, dry-lens, perf-lens, comment-lens, telemetry-lens, owner-lens; the tripwire keys on the
PREFIX, not on line position), or this wave is NON-CLEAN and re-run:
  owner-lens loaded: owning the row is not owning the path | db/authz surface: <list | "none — no policy/grant/DEFINER/service-role/use-server/route/tool change in diff">
("none" is a CLEAN pass — this lens is CONDITIONAL and a diff with no DB/authz surface is never
penalised for it. A missing/garbled owner-lens line = NON-CLEAN. A wrongful "none" on a diff that DOES
touch a migration, a policy/grant, a DEFINER function, a storage bucket, a service-role client, a
`"use server"` file, a route handler, or an assistant tool is a first-class DEFECT.)

FIRES ON: supabase/migrations/**; CREATE POLICY | GRANT | REVOKE | SECURITY DEFINER | CREATE OR REPLACE
FUNCTION; a storage bucket or its policies; a client built from SUPABASE_SERVICE_ROLE_KEY (in practice
apps/web/src/lib/supabase/service-role.ts and the cost sink and writer in apps/web/src/lib/ai and the quote sink and writer in apps/web/src/lib/quotes that use it); any `"use server"` file; apps/web/**/route.ts (incl. /api/inngest and the chat route)
or any other HTTP route handler; an assistant tool definition. Nothing in that list touched → N/A, and
the wave is clean.

MODEL: single-user ownership — no organizations, no tenants. Every row has `user_id uuid` referencing
auth.users (except the reference tables `fx_rates`, `prices` and `instruments`: market data with no
`user_id`, read by every authenticated user; `service_role` inserts quotes and nobody writes
`instruments`, which its migration seeds; the pgTAP floor limits the exception to those three, and
they keep the MFA gate); the house policy is `for all to authenticated using (user_id = (select auth.uid())) with
check (user_id = (select auth.uid()))`, plus the RESTRICTIVE MFA gate from the house form on every
`public` table (the pgTAP floor pins its text); `authenticated` is granted only the verbs the app uses, `anon`
nothing; DEFINER helpers live in schema `private` with `SET search_path`; the service-role key never
reaches the frontend.

THE ONE LAW: every write path must constrain that the row — AND everything the row points to — belongs
to the caller, and every path that bypasses RLS must carry its own user_id boundary. Owning the row is
not owning what it references; a user id the caller supplied is not authorization.
(FUNDAMENTALS are NOT restated — `.agents/skills/supabase-postgres-best-practices/references/`:
security-rls-{basics,performance}.md, security-privileges.md, schema-constraints.md. This lens is the
adversarial half: the shapes that SATISFY those references and are still exploitable.)

THE FIVE CO-EQUAL LAWS — check and REPORT each (an unstated law is UNCHECKED, not passed):
1. PREDICATE-CONSTRAINS-OWNERSHIP — every INSERT/UPDATE predicate pins user_id to (select auth.uid()),
   on the row AND on every owned row it references. Three shapes:
   (a) `WITH CHECK (user_id = (select auth.uid()))` on a CHILD table (holdings.import_id, a row hanging
       off an import/account) proves the caller owns the ROW, never the PARENT it references — the
       attacker inserts his own row pointing at YOUR import, and every join through the parent surfaces
       it in your net worth or your assistant's context (prompt injection). That expression is the
       PERFORMANCE form security-rls-performance.md teaches; perf-correct is not authz-correct — attack
       every foreign key. Fix: composite FK `(parent_id, user_id) references parent (id, user_id)`, or a
       WITH CHECK that asserts the parent's owner.
   (b) UPDATE policy with NO `WITH CHECK` — Postgres silently reuses USING, which was written to pick
       which rows you may TOUCH, never what they may BECOME: the caller rewrites user_id and hands his
       row to another user.
   (c) server-owned column with no write guard — user_id, an import's status, extraction output, an
       AI-cost/audit field — made client-writable by a table-wide `grant update`. Use column-level
       grants or a function. Enumerate the VERBS: a guard on three of four is a hole. audit_log is
       append-only: no UPDATE/DELETE grant or policy at all.
2. DEFINER-DERIVES-IDENTITY — a SECURITY DEFINER function authorizes from the SESSION
   ((select auth.uid())), NEVER from a caller-supplied p_user_id — and an id that implies ownership
   (p_import_id) is checked against the session before use; the fix is usually to drop the parameter.
   Also: `CREATE OR REPLACE` silently DROPS proconfig — check `select proconfig from pg_proc` FIRST and
   carry `SET search_path` forward (prefer `''` with qualified names; do not pin it to 'public' when the
   body calls an `extensions` function such as gen_random_bytes). Helpers belong in schema `private`.
3. REACHABILITY = GRANT × POLICY — check BOTH halves: a policy without a grant is unreachable, a grant
   without a constraining policy is open. ⚠️ `REVOKE ... FROM PUBLIC` is a NO-OP here — the base schema's
   `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON FUNCTIONS TO anon` gives every new public function an
   EXPLICIT per-role grant, and FROM PUBLIC strips only the implicit entry. The revoke must name the roles:
     REVOKE ALL ON FUNCTION public.f() FROM PUBLIC, "anon", "authenticated";
   Corollary: a CREATE OR REPLACE that CHANGES a signature is a NEW object with fresh default grants — the
   old revoke does not follow it. Any grant to anon = defect. A DEFINER function with no caller check that
   RETURNS IDENTIFIERS is an enumeration oracle. Realtime (the UI follows `imports`) delivers whatever the
   SELECT policy allows; storage bucket policies must pin the `<user_id>/` path prefix to the session.
4. BYPASS-CARRIES-ITS-OWN-BOUNDARY — where RLS is off, the code is the ONLY boundary:
   • service-role client (Inngest steps in packages/jobs) → every query carries its OWN `user_id` filter,
     even when it already selects by import_id, and every storage path is asserted against the owner's
     `<user_id>/` prefix (the reference tables `fx_rates`/`prices`/`instruments` have no owner key; there the column
     grants are the boundary). The user_id comes from a server-trusted source (the imports row, a
     server-sent event), never a client payload field.
   • the service-role key → server-only: never NEXT_PUBLIC_, never reachable from a client component;
     the module building it starts with `import "server-only"`.
   • `"use server"` file → EVERY export is an independently invokable network endpoint, so a module of
     primitives taking a caller-supplied userId/importId through a service-role client is a set of
     unauthenticated endpoints. Each action derives the user from the session.
   • route handlers → /api/inngest rejects requests not signed with the Inngest signing key; the chat
     route takes the user from the session, never the body.
   • assistant tools → read-only, closed over the session user_id; a tool taking userId (or any
     owner-implying id) from the MODEL's arguments is an IDOR with a natural-language front door.
5. VERIFIED-TO-FAIL — a security test never OBSERVED to fail proves nothing. Every fix in this taxonomy
   ships a test verified to fail against the PRE-FIX state AND asserting the LEGITIMATE path still works
   (else a "fix" that merely breaks the feature passes). DB-layer regressions go in supabase/tests/
   (pgTAP) and their HTTP view in security-tests/ (`pnpm test:security`), both run in CI, with two
   users: B cannot read, insert into, update, reassign, or reference A's rows. A spec
   that `return`s when its target is unreachable prints PASS while asserting nothing.
   Matcher discriminator: a USING violation filters SILENTLY (0 rows, no error) while a WITH CHECK
   violation raises 42501 — the wrong matcher passes vacuously either way.

SEVERITY: unpinned write predicate / unchecked owned-parent reference / UPDATE without WITH CHECK /
client-writable server-owned column / DEFINER authorizing from a parameter / DEFINER with no caller check
or no search_path / FROM PUBLIC-only revoke / any anon grant / service-role query with no user_id filter /
service-role key reachable from the frontend / `"use server"` unauthenticated primitives / unsigned
/api/inngest / assistant tool taking an owner id from the model / a fix with no pre-fix-failing test
= HARD blockers (any one = does not merge). A broader standing authenticated grant the diff does not
touch = raise-and-downgradable (state it).

FIX every violation in this change. The only deferrable is a pre-existing one outside this change's
reach — RAISE it and file a follow-up, never tolerate it silently.

PER-LAW VERDICT: if the change touches any surface in FIRES ON, emit PASS|DEFECT + one line for each of
the five laws. If it touches none, emit exactly:
  owner: N/A — no db/authz surface (no migration/policy/grant/DEFINER/bucket, no service-role client, no "use server" file, no route handler, no assistant tool).
=== END OWNER-ISOLATION LENS ===
```
