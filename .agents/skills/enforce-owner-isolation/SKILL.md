---
name: enforce-owner-isolation
description: >-
  The strict enforcement lens for per-user owner isolation — an RLS policy that checks `user_id` on
  read but not on write, an UPDATE policy with no `WITH CHECK`, a child row pointing at a parent the
  caller does not own, a `SECURITY DEFINER` function trusting a caller-supplied user id, a
  service-role job or `"use server"` path with no `user_id` filter of its own, an assistant tool that
  takes the user id from the model. Plugs into any review or planning pass. Use for "enforce owner
  isolation", "check the RLS policies", "can another user reach this", "review this migration for
  security", "cross-user", "IDOR", "who can call this function". CONDITIONAL, unlike the always-on
  lenses: a no-op on a diff with no DB or authz surface.
---

# Enforce Owner Isolation — the owning-the-row-is-not-owning-the-path law

This is a **language guide**, not a workflow. Load it as the lens for a pass whose sole job is to
prove a change cannot be driven across a user boundary. Plant is single-user ownership: no
organizations, no tenants, no shared rows. Every row belongs to exactly one user (`user_id uuid`
referencing `auth.users`), and nothing one user does may read, write, or influence another user's
portfolio, debts, imports, or assistant context. The bar is deliberately unforgiving, because every
shape below reads like ordinary code and is the kind that ships in real Supabase apps.

> **Postgres/Supabase fundamentals are not restated here.** How RLS works, the
> `(select auth.uid())` performance form, least-privilege grants and constraint design live in
> `.agents/skills/supabase-postgres-best-practices/references/` —
> `security-rls-basics.md`, `security-rls-performance.md`, `security-privileges.md`,
> `schema-constraints.md`. Read those for the machinery. **This guide is the adversarial half: the
> shapes that satisfy those references and are still exploitable.** Two of them actively set up
> defects here, flagged inline under laws 1 and 3.

## The house form (what every owned table looks like)

```sql
alter table public.<t> enable row level security;

create policy <t>_owner on public.<t>
  for all to authenticated
  using      (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update on public.<t> to authenticated;  -- only the verbs the app uses
revoke all on public.<t> from anon;
```

Helpers live in schema `private`; every `SECURITY DEFINER` function carries `SET search_path`; every
function gets `REVOKE ... FROM PUBLIC, anon, authenticated` before any targeted grant; the
service-role key never reaches the frontend. Deviating from this form is not automatically a defect,
but it is always a question the change must answer.

## The one law

**Every write path must constrain that the row — and everything the row points to — belongs to the
caller, and every path that bypasses RLS must carry its own `user_id` boundary. Owning the row is not
owning what it references, and a user id the caller supplied is not authorization.**

## The five co-equal laws

All five must be CHECKED and REPORTED on a change with a DB/authz surface — a law you did not
mention is UNCHECKED, not passed.

1. **Predicate-constrains-ownership** — every write predicate pins `user_id` to the session, on the
   row and on every owned row it references.
2. **Definer-derives-identity** — a DEFINER function authorizes from the session, never a parameter.
3. **Reachability = grant × policy** — who holds the grant, and what constrains them once they have it.
4. **Bypass-carries-its-own-boundary** — where RLS is off, the code is the only boundary.
5. **Verified-to-fail** — a security test never observed to fail proves nothing.

---

## Law 1 — Predicate-constrains-ownership

> **Attack question:** for every INSERT and UPDATE policy, does the predicate pin `user_id` to
> `(select auth.uid())` — and for every foreign key to another owned table, what stops the caller
> pointing it at a row someone else owns?

- **Owning the row is not owning its parent.** `WITH CHECK (user_id = (select auth.uid()))` on a
  child table (`holdings.import_id`, `import_files.import_id`, a debt or valuation row referencing an
  account) proves *the caller owns this row* and never *the caller owns the parent it hangs off*. The
  attacker inserts a row about himself that references your import, and every query that joins
  through the parent now surfaces his row in your portfolio — a fake holding in your net worth, or
  his untrusted text in your assistant's context (prompt injection). This is the exact expression
  `references/security-rls-performance.md` teaches — correctly, for performance. That reference says
  nothing about the foreign keys on the same row. **Perf-correct is not authz-correct.** Fix: a
  composite foreign key `(parent_id, user_id) references parent (id, user_id)` (with a unique
  constraint on the parent's `(id, user_id)`), or a `WITH CHECK` that also asserts the parent's
  ownership.
- **UPDATE with no `WITH CHECK`.** Postgres silently reuses `USING` as the check, and `USING` is
  written to pick *which rows you may touch*, never *what they may become*. A `USING`-only UPDATE
  policy lets the caller rewrite `user_id` on his own row and hand it to another user — the same
  injection as above, by a different verb. Every UPDATE policy gets an explicit `WITH CHECK` naming
  `user_id`, and the `for all` house form carries both clauses.
- **Server-owned column with no write guard.** Can any client write path set a column that only the
  server should decide — `user_id`, an import's `status` (`confirmed`, `failed`), extraction output,
  an AI-cost or audit field? A table-wide `grant update ... to authenticated` makes every column
  client-writable, whatever the UI does. Grant `UPDATE` only on the columns the user may edit
  (column-level grant), or route the transition through a function. Enumerate the verbs: a guard on
  three of four is a hole. `audit_log` is append-only — no `UPDATE`/`DELETE` grant or policy at all.

## Law 2 — Definer-derives-identity

> **Attack question:** does any SECURITY DEFINER function take a user id (or anything that resolves
> to one) and use it for AUTHORIZATION rather than as data?

- A DEFINER function with a `p_user_id uuid` parameter that it filters on lets any authenticated
  caller act as any user. The fix is almost always to drop the parameter and derive from
  `(select auth.uid())`. The same holds for an id that implies ownership: a function taking
  `p_import_id` must check that import's `user_id` against the session before touching it.
- **`CREATE OR REPLACE` silently drops `proconfig`.** Re-declaring a function without its existing
  `SET search_path` reverts it. Run `select proconfig from pg_proc where proname = '<f>'` *before*
  any replace and carry the settings forward. Do not then "fix" it by pinning `search_path = 'public'`
  when the body calls an extension function — `gen_random_bytes` and friends live in `extensions`;
  prefer `set search_path = ''` with fully qualified names.
- **Helpers live in `private`.** A DEFINER helper used by policies belongs in schema `private`, which
  PostgREST does not expose. A DEFINER function in `public` is a callable RPC unless its grants say
  otherwise — see Law 3.

## Law 3 — Reachability = grant × policy

> **Attack question:** who holds a grant on this object, and what constrains them once they have it?

- **`REVOKE ... FROM PUBLIC` is a no-op on Supabase.** The base schema runs
  `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON FUNCTIONS TO anon` (and `authenticated`), so every new
  public function is created with an **explicit** per-role grant. `FROM PUBLIC` strips only the
  implicit entry and leaves the explicit ones intact. The revoke must name the roles:
  ```sql
  REVOKE ALL ON FUNCTION public.f() FROM PUBLIC, "anon", "authenticated";
  ```
  Then grant back only what the app calls. Corollary: a `CREATE OR REPLACE` that **changes a
  signature** creates a NEW object with fresh default grants — the old revoke does not follow it.
  `references/security-privileges.md` closes on `revoke all ... from public`: right for general
  Postgres, insufficient here.
- **A DEFINER function with no caller check at all.** Ask both halves: does it check the caller, and
  if it returns identifiers (user ids, import ids, storage paths), does it enable enumeration? Ids are
  only "unguessable" until something hands them out, and a Law-1 defect is one known id away from
  live.
- **Table grants are the other half of the PostgREST gate.** A policy without a grant is unreachable;
  a grant without a constraining policy is open. Check both. Supabase's default privileges also hand
  tables to `anon`; Plant grants `authenticated` only the verbs the app uses and never grants `anon`
  anything. A standing `anon` grant inert only because every policy resolves through `auth.uid()` is
  one Law-1 defect away from live.
- **Realtime and Storage are reached through the same gate.** The UI follows `imports` over Supabase
  Realtime, which delivers only the rows the subscriber's SELECT policy allows — a loose SELECT policy
  leaks over the socket as well as over REST. Storage objects (uploaded broker files) need bucket
  policies that pin the path's `<user_id>/` prefix to `(select auth.uid())`; a private bucket with an
  `authenticated`-wide policy is a shared bucket.

## Law 4 — Bypass-carries-its-own-boundary

> **Attack question:** once RLS is not the boundary, what is?

- **Service-role clients (jobs).** Inngest steps in `packages/jobs` run with the service role, so RLS
  is bypassed and the query's own `.eq("user_id", …)` is the ONLY boundary. Every service-role query
  carries its own `user_id` filter — including the "obviously scoped" ones that select by
  `import_id` — and every storage path is asserted against the owner's `<user_id>/` prefix before it
  is read. The `user_id` must come from a server-trusted source (the `imports` row the job owns, or
  an event the server sent after verifying the session), never from a client-supplied payload field.
- **Zero service-role in the frontend.** The service-role key is server-only: never `NEXT_PUBLIC_`-
  prefixed, never imported from a module a client component can reach. A server module that builds a
  service-role client starts with `import "server-only"`.
- **`"use server"` on a module of unauthenticated primitives.** Every export of a `"use server"` file
  is an independently invokable network endpoint. Helpers that take a caller-supplied `userId` or
  `importId` and act through a service-role client are a set of unauthenticated endpoints. Each
  action derives the user from the Supabase session itself; shared primitives live in a plain module
  guarded by `import "server-only"`, not in the `"use server"` file.
- **Route handlers.** `/api/inngest` is a public URL: it must reject requests not signed with the
  Inngest signing key, or anyone can trigger an import step for any `user_id`. The chat route handler
  derives the user from the session, never from the request body.
- **The assistant is a caller too.** The model's tool arguments are untrusted input. Assistant tools
  are read-only and scoped to the session user: the tool closes over the session's `user_id` at
  construction and takes no user id (or other owner-implying id) from the model. A tool that accepts
  `userId` from its arguments is an IDOR with a natural-language front door.

## Law 5 — Verified-to-fail

**A security test that has never been observed to FAIL proves nothing.** A spec that `return`s
instead of skipping when its target is unreachable, or that never runs in CI, reports PASS while
asserting nothing — and a hole can survive for months behind a green suite.

- Every fix for a defect in this taxonomy ships a test **observed to fail against the pre-fix state**.
- It must also assert the **legitimate path still works** — otherwise a "fix" that simply breaks the
  feature passes.
- DB-layer regressions belong in `supabase/tests/` (pgTAP), run in CI. Test with two users: user B
  cannot read, insert into, update, reassign, or reference user A's rows.
- **Use the matcher the policy dictates:** a `USING` violation filters *silently* (0 rows, no error);
  a `WITH CHECK` violation raises `42501`. A test expecting a throw where the policy filters passes
  vacuously, and so does the reverse.

---

## Severity

**HARD blockers** (any one = the change does not merge): a write predicate that does not pin
`user_id` to the session; a child row whose owned-parent reference is unchecked; an UPDATE policy
with no `WITH CHECK`; a client-writable server-owned column; a DEFINER function authorizing from a
parameter; a DEFINER function with no caller check; a DEFINER function without `SET search_path`; a
`FROM PUBLIC`-only revoke on a default-granted function; any grant to `anon`; a service-role query
with no `user_id` filter; a service-role key reachable from the frontend; a `"use server"` module of
unauthenticated primitives; an unsigned-request-accepting `/api/inngest`; an assistant tool taking an
owner-implying id from the model; a fix shipped without a test observed to fail pre-fix.

**Raise-and-downgradable** (a defect, always reported; drops to a tracked follow-up only if
pre-existing AND outside this change's reach — state the downgrade, never default to it): a broader
standing `authenticated` grant (an unused verb) the diff does not touch.

## When this lens fires

CONDITIONAL, unlike the ports/DRY/perf/comment/telemetry lenses. It activates when the diff touches
any of: `supabase/migrations/**`; a `CREATE POLICY` / `GRANT` / `REVOKE` / `SECURITY DEFINER` /
`CREATE OR REPLACE FUNCTION`; a storage bucket or its policies; a client built from
`SUPABASE_SERVICE_ROLE_KEY` (in practice, `packages/jobs/**`); a `"use server"` file;
`apps/web/**/route.ts` (including `/api/inngest` and the chat route) or any other HTTP route handler;
an assistant tool definition. It is a **no-op otherwise** — a diff with none of that surface passes
this lens clean, and does not pay for it.

## Delivery

When applied via a subagent wave, this lens is delivered as the condensed block at
`.claude/skills/_shared/owner-lens/condensed-lens.md` (pasted verbatim per subagent), which carries
the load-proof echo (`owner-lens loaded: … | db/authz surface: <list|none>`; missing = NON-CLEAN)
and the per-law verdict contract. This file is the orchestrator's full reference.

It sharpens the defect catalog's **[authorization / owner-scoping / IDOR]** class rather than replacing it: the catalog names the class, this
guide carries the attack questions and the shapes.
