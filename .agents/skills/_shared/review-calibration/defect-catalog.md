# Review defect catalog — shared calibration

The single shared calibration data file for this repo's PR reviews. Both `adv-review`
(both its converge-and-fix and verdict-only paths) Reads this file
BEFORE their first pass, so every reviewer looks hardest where this repo actually breaks. This
is a KNOWLEDGE file, not a workflow — it lists calibrated defect classes, their real frequency,
where to look, and the confirmed fix. It does not tell you how to run a review.

Ports-and-adapters violations are NOT catalogued here — that lens has its own full guide. Load
`.claude/skills/enforce-ports-and-adapters/SKILL.md`: adapter-specific logic lives ONLY inside
its adapter behind the shared contract; nothing else — handlers, tests, components, helpers,
seeds — may branch on which concrete implementation is in play, and everything flows through the
injected port. Read that file for the enforcement language.

DRY-progression / when-to-extract is not fully catalogued here either — load
`.claude/skills/enforce-clean-code/SKILL.md` for the mandatory 2nd-occurrence check, the
same-concept/changes-together discriminator, and the wrong-abstraction guard. The `[DRY-progression /
copy-paste drift]` class below is only the look-here index; the rule lives in that guide.

Comment value / when a comment earns its keep is not fully catalogued here either — load
`.claude/skills/enforce-comment-value/SKILL.md` for the bug-filing test, the derivable/recoverable
classifier, the change-narration rule, and the five verdicts. The `[code comment narrates the change…]`
class below is only the look-here index; the rule lives in that guide.

## Contents
- [How to use](#how-to-use)
- [Entry schema](#entry-schema-every-catalogued-class)
- [Curated](#curated-auto) — the calibrated defect classes (what recurs, where to look, the confirmed fix)
- [Emerging](#emerging) — weaker-signal / single-PR candidates; graduate on frequency
- [Known false-positives](#known-false-positives--never-raise) — never raise these

## How to use
- Read the whole file before Pass 1 / Wave 1. Treat every Curated class as a place a bug is
  statistically likely — go look there, don't wait for it to jump out.
- Frequency = how often this class actually broke across the last ~200 PRs (order of magnitude,
  not exact). Higher = look harder. The seed frequencies were calibrated on a predecessor codebase
  with the same stack (Next.js + Supabase + TypeScript monorepo); recalibrate them from Plant's own
  PR history as it accumulates.
- Check "Known false-positives" before raising a finding — the listed shapes are correct as
  written; raising them wastes a finding.
- Curated = confirmed recurring, human-authored or human-confirmed. Emerging = weaker signal,
  advisory. This file is append-safe: automated/manual additions go ONLY between the AUTO-APPEND
  sentinels, in the correct tier, using the entry schema below.

## Entry schema (every catalogued class)
**[class name]**
- Pattern: the defect shape in one line.
- Frequency: ~N over last ~200 PRs (or high-sev/occasional).
- Where: the files / layers / query shapes to inspect.
- Example: a concrete instance (PR#/symptom) when known.
- Fix: the confirmed correct resolution.
- source: where the class was calibrated from.

<!-- AUTO-APPEND:START -->

## Curated (auto)

**[money / financial math]**
- Pattern: valuation/FX/net-worth math that mislabels units, mixes currencies, rounds through a float, or uses the wrong date's rate.
- Frequency: ~12.
- Where: anything touching `Money` / decimal strings (`@plant/shared` `money.ts`, `pricing.ts`), `@plant/core` valuation and portfolio functions, ARS↔USD (MEP) conversion, net-worth and debt totals, aggregation across holdings.
- Example: `Number(amount)` / `parseFloat` on a decimal string before summing; an ARS amount added to a USD total; a valuation converted at today's MEP rate while labelled with the holding's as-of date; an amount with no currency; `?? 0` coercing a missing price/comparison to a real 0.
- Fix: keep amounts as Postgres `numeric` / decimal strings end to end and use a decimal library for arithmetic, never float; every amount carries its currency and is converted explicitly with a dated rate; convert-then-sum, never sum mixed currencies; missing value → em-dash/"sin dato", not 0.
- source: senior Pass-2.

**[idempotency / concurrency / atomicity]**
- Pattern: a retry or two concurrent writers corrupts state; multi-step writes without one txn/CAS orphan a row; a cursor derived from the destination advances past unwritten rows.
- Frequency: ~8 (most common defect class here).
- Where: the import lifecycle (`imports` state transitions, confirm-import, cancel), Inngest steps (every step re-runs on retry), insert+update+fan-out, delete-then-insert, read-then-write, job/event IDs.
- Example: an Inngest step that inserts holdings without an idempotency key double-inserts on retry; a confirm button double-submit applies an import twice; a `Date.now()`-embedded event/job ID double-runs; a zero-row conditional update (CAS) returning success; a cancel racing a step that then overwrites `cancelled` with `done`.
- Fix: derive cursors from the source of truth; one transaction (RPC) or CAS+rollback; state transitions guarded by the expected prior state; validate before commit; unique index against zombie double-insert; stable retry/event IDs and Inngest step ids.
- source: senior Pass-2.

**[keyset pagination soundness]**
- Pattern: offset paging over a live table shifts rows; `range` without `order` misses rows; missing tie-break / `has_more`; a full `.in()` exceeds URL length.
- Frequency: ~9.
- Where: any PostgREST list/scan, RPC returning a page, drain loops.
- Example: unbounded scan hits PostgREST's 1000-row cap; offset paging over a hot table skips rows mid-write.
- Fix: keyset `order('id')` with total-order tie-break; chunk `.in()`; explicit `order` before `range`.
- source: senior Pass-3; review migration gate.

**[migration EXPLAIN gate + non-sargable predicates + authenticated timeout budget]**
- Pattern: DB-executed SQL (query/RPC/function/view/trigger/index) shipped without an EXPLAIN(ANALYZE) plan against a LARGE user dataset; non-sargable predicates; an authenticated-role query exceeding the 8s `statement_timeout`.
- Frequency: ~4 (perf), CRITICAL when present.
- Where: every migration and every RPC/query reachable via PostgREST as `authenticated`.
- Example: `COALESCE(...)`/function on a column in WHERE/JOIN; `Seq Scan` on a hot table inside a correlated `SubPlan` with `loops=N`; a 12s authenticated query that silently aborts in prod but "works" in psql; an RLS predicate written as `auth.uid()` instead of `(select auth.uid())`, re-evaluated per row.
- Fix: paste the EXPLAIN plan against a user with 100k+ rows; reshape to sargable / expression index; index `user_id` (leading) on every owned table; keep the authenticated path under 8s; the index ships in the SAME PR, never "later".
- source: adv-review migration gate.

**[migrations — reversible, lock-safe, ordered]**
- Pattern: timestamp below staging's max; unbackfilled new column; changed RPC shape without regenerated types; RLS enabled with zero policies; missing explicit `statement_timeout=0`/`lock_timeout=0`; unflagged large/hot-table lock risk; a destructive change without the `[DESTRUCTIVE]` PR-title prefix.
- Frequency: ~5.
- Where: `supabase/migrations`, the generated DB types in `@plant/shared` (`pnpm db:generate:supabase-types`), pgTAP tests in `supabase/tests`, growing per-user tables (e.g. `imports`, `audit_log`, holdings/valuation history).
- Example: RLS on with no policy returns `200 []` to the legitimate owner; a large-table ALTER holding ACCESS EXCLUSIVE with no timeout override aborts mid-scan.
- Fix: timestamp > staging max; backfill existing rows; regenerate types (prefer the generated `Returns` shape); set `statement_timeout=0` explicitly; flag lock/rewrite risk + chosen timeout in the PR body; ship the pgTAP test with the migration.
- source: senior Pass-2; adv-review.

**[authorization / owner-scoping / IDOR]**
- Pattern: trusting a client-supplied `userId`/`importId`/`holdingId` without the owner check; a policy that pins `user_id` in `USING` but not `WITH CHECK`; a service-role path (jobs) that forgets its explicit `user_id` filter; a `SECURITY DEFINER` function that takes the user id as a parameter; an assistant tool that reads by id without scoping to the session user.
- Frequency: ~2 but highest severity.
- Where: request-body-derived identity in route handlers and `"use server"` actions, RLS policies and grants, `packages/jobs` service-role clients, Inngest event payloads, assistant `tool.execute(args)` paths.
- Example: an Inngest function loads an import by `event.data.importId` with the service role and writes holdings without checking the import's `user_id`; an UPDATE policy without `WITH CHECK` lets a user re-own a row; an assistant tool accepts a `userId` argument from the model.
- Fix: derive identity from the session (`auth.uid()` / the server-side Supabase client), never from the body or the model; `user_id = (select auth.uid())` in both `USING` and `WITH CHECK`; service-role code filters by `user_id` explicitly; Zod-parse every body/tool input against its schema. See `enforce-owner-isolation`.
- source: senior Pass-2.

**[stale cache / state after mutation, user-switch, retry, error]**
- Pattern: mutation invalidates the wrong React Query key (or only on `success:true`); local state not reset to the server row's status after failure/reload; global cache not cleared on sign-out; a Realtime subscription left open or not re-keyed after sign-out/user-switch.
- Frequency: ~5.
- Where: frontend mutations, import-progress UI (Supabase Realtime on `imports`), sign-out listeners, cookie/prop-backed ids for deleted entities.
- Example: stuck error banner because state never reset; cross-user leak because cache not cleared on sign-out; a returned `{error}` (not thrown) skips the update; import progress frozen because the Realtime channel missed the terminal state and nothing re-reads the row.
- Fix: invalidate the exact key on settle; reset local state from the server row; clear global cache on sign-out; on (re)subscribe, read the current row before trusting the event stream.
- source: senior Pass-3.

**[silently-swallowed / unchecked errors]**
- Pattern: reading `.data` while ignoring `.error`; helper that never rethrows; `fireAndForget` synthetic success; a catch re-mapping a non-retryable failure to retryable (or the reverse).
- Frequency: occasional, high-sev.
- Where: every delete/update/select that matters, `Promise.all` legs, Inngest step catch blocks, `SourceError` handling, shell scripts.
- Example: a catch that rethrows a `SourceError` with `retryable: false` as a plain `Error`, so Inngest retries a malformed upload forever; an AI-extraction failure mapped to an empty holdings list ("success, 0 holdings"); `set -uo pipefail` without `-e`.
- Fix: check `.error` everywhere; respect `SourceError.retryable` and rethrow non-retryable as Inngest `NonRetriableError`; no synthetic success; an empty extraction is a reviewable outcome, not a silent success.
- source: senior Pass-3.

**[provider-name leak / flavor-blind]**
- Pattern: a concrete source/broker/AI-provider name in a shared identifier, test name, or comment; or shared code blind to a provider difference it should route through the port.
- Frequency: ~5.
- Where: identifiers, test names, comments across `@plant/core`, `@plant/jobs`, `apps/web`, and the shared parts of `@plant/sources` (outside the adapter).
- Example: core code branching on a broker's name instead of a normalized field; a test named for one broker exercising the generic path; an engine import (Inngest, a model SDK) inside a pure step in `sources`/`core`.
- Fix: provider-agnostic terms behind `PortfolioSourcePort` / `JobRunner`; adapter-specific behaviour lives in its adapter and is surfaced through the capability matrix. Real enum VALUES (source adapter keys like `file_upload`, generated DB types, live API URLs) are EXEMPT — actual product identifiers.
- source: house convention (provider names stay behind the port).

**[no silent identity/categorical defaults]**
- Pattern: currency/source/asset-class/locale or any closed enum falling back to a hardcoded member.
- Frequency: occasional, silent-wrong-data.
- Where: product code, extraction normalization, scripts, migrations alike.
- Example: an extracted amount with no detectable currency defaulted to `ARS`; an unknown instrument type defaulted to a stock.
- Fix: fail loudly, return `unknown` for user review, or require explicit input — never guess a member.
- source: adv-review Rules; no-silent-defaults.

**[type-tightness / no primitive obsession]**
- Pattern: a domain identity travelling as a bare primitive; the same field-shape re-inlined across files instead of a named type composed with `&`.
- Frequency: occasional (cleanliness).
- Where: user/import/holding id args, amounts as bare `string`/`number` instead of `Money`, repeated `{ ...; amount: string; currency: string }` shapes.
- Fix: define the identity/shape once as a named type (e.g. `Money`, `Currency` from `@plant/shared`); intersect/reuse. (This is the repeated-TYPE case; a repeated BEHAVIOUR/RULE/constant is `[DRY-progression / copy-paste drift]` below.)
- source: adv-review Rules; type-tightness-no-primitive-obsession.

**[DRY-progression / copy-paste drift]**
- Pattern: a 2nd occurrence of one concept copy-pasted / re-implemented (incl. re-implementing an existing repo helper) instead of extracted; OR a forced/flag-parameterized abstraction over coincidental similarity.
- Frequency: occasional; highest-drift = cross-package (`apps/web` ↔ `@plant/core`/`@plant/shared`) + hand-copied constants/enums.
- Where: a new fn/constant/guard whose body already exists elsewhere in the repo; duplicated logic across packages; valuation math re-implemented in a component instead of calling `@plant/core`.
- Fix: run the mandatory 2nd-occurrence check — extract genuine same-concept/changes-together duplication (or reuse the existing helper), else LEAVE with a falsifiable rationale. See `enforce-clean-code` for the discriminator (do not restate it here).
- source: enforce-clean-code (single source).

**[persisted category must be a DB-side Postgres enum]**
- Pattern: a persisted closed string category stored as `text`+CHECK or free `text` instead of a Postgres enum.
- Frequency: occasional (completeness criterion).
- Where: new persisted columns (import status, currency, source kind, asset class).
- Example: category not surfaced in the generated DB types because CHECK doesn't; a speculative enum value no code emits.
- Fix: real Postgres enum in `public`; point TS at the generated `Enums` type (and derive the zod enum from it rather than hand-copying); no speculative values; verify prod distinct values before a prod text→enum ALTER (full-table AE-lock rewrite).
- source: enum-conventions.

**[no version markers in code]**
- Pattern: `v2`/`old`/`new`/`legacy`/`next` in identifiers, types, filenames, or comments.
- Frequency: occasional (cleanliness).
- Where: everywhere — files, consts, functions, comments.
- Fix: name things by what they ARE. EXEMPT: external SDK identifiers you can't rename and `next` as iteration semantics.
- source: house convention (no-version-markers).

**[code comment narrates the change instead of stating current behavior]**
- Pattern: a code comment describing the EDIT, not current behaviour — EXPLICIT ("was X, now Y", "previously", "no longer") or IMPLICIT/comparative ("rather than X", "instead of X", "unlike X").
- Frequency: occasional (cleanliness).
- Where: comments and docstrings added or touched by the diff, especially beside edited/renamed/moved logic.
- Example: `// this was in USD, now ARS` → `// ARS`; `// keyset-paginate, rather than OFFSET` → `// keyset-paginate`.
- Fix: see `enforce-comment-value` — state only current behaviour; strip every prior/other/rejected contrast; change narrative and migration notes live in the PR body, not the code.
- source: user directive (comment-vs-PR split).

**[doc / PR-body over-claim vs implementation]**
- Pattern: the PR body or a comment claims behavior the diff doesn't deliver (or a refactor silently reverts a shipped feature / drops a returned field).
- Frequency: ~4.
- Where: PR description vs diff; stacked chains (check the MERGED result, not one diff).
- Fix: reconcile claim with code; treat a silent feature revert / dropped field as a finding.
- source: senior Pass-1.

**[AI boundary — untrusted text, read-only tools, descriptive only]**
- Pattern: document/user text reaching a prompt without going through `prompt-text.ts`; an assistant tool that writes, or reads beyond the session user; assistant output or copy that recommends buying/selling instead of describing; extracted data persisted without the user's review/confirm step.
- Frequency: occasional, high-sev.
- Where: the chat route handler and its `ToolLoopAgent` tools, extraction prompts and consensus code, import confirm flow, evals under `evals/`.
- Example: a broker PDF's text interpolated raw into the extraction prompt (prompt injection); a new tool that accepts an arbitrary id; extracted holdings written straight to the portfolio on job completion.
- Fix: route all untrusted text through `prompt-text.ts`; tools stay read-only and scoped to the session user; keep the review-then-confirm gate; add or update an eval when prompt/extraction behaviour changes.
- source: house convention (AI boundary).

**[perf: cost × call frequency]**
- Pattern: a query cheap in isolation but run per-row/per-batch/per-page/per-step on a hot table, or whose result isn't used every call.
- Frequency: ~4.
- Where: drain loops, batch fan-out, Inngest step loops, retries, per-holding price/valuation lookups.
- Example: a full-portfolio aggregate recomputed on every batch of an import when only the first batch's value is kept = O(batches × rows); a price lookup per holding instead of one batched query.
- Fix: multiply per-call cost by call frequency; hoist invariants; batch lookups; precompute an active-set CTE.
- source: adv-review migration gate.

**[deploy / CI wiring / health-readiness / torn-deploy]**
- Pattern: a new Inngest function not registered in the `/api/inngest` serve handler; a job or route racing its migration; an env var added locally but not in Vercel; a "shipped" claim based on the merge or the `production-latest` tag while the running Vercel deployment or the production DB migrations lag.
- Frequency: occasional, real incidents here.
- Where: `packages/jobs` function registry, `apps/web/src/app/api/inngest/route.ts`, `apps/web/vercel.json`, env wiring, the "Promote to production" workflow, migration application.
- Fix: register every function in the serve handler; land migrations before the code that needs them; verify the running deployment's commit and the applied migrations, not just merge/tag.
- source: senior Pass-3.

**[user-facing copy speaks the user's language, not engineering]**
- Pattern: implementation vocabulary in any human-read UI string (warning/hint/note/error `message`/`title`/nav label).
- Frequency: occasional.
- Where: user-facing copy only (Spanish, for an Argentine retail investor). EXEMPT: LLM prompt text, dev logs, code comments, schema `.describe()`, internal enum strings.
- Example: banned — `job`, `step`, `consensus`, `payload`, `sync`/`self-heals`, `RLS`, "the provider", "extraction failed: schema mismatch". KEEP legit investing terms (`tenencia`, `cotización`, `dólar MEP`, `patrimonio`, `CEDEAR`, `FCI`).
- Fix: rewrite in plain Spanish the user can act on, one or two sentences.
- source: adv-review Rules.

**[user-facing copy — short, strategically framed, on-brand]**
- Pattern: a human-read UI string (tooltip/hover, toast, banner, dialog, empty state, inline hint, error) that is longer than it needs to be, uses an em dash, or is worded flatly/negatively instead of framing the moment the way we want the user to feel — or whose tone drifts from the rest of the app; or copy that reads as investment advice.
- Frequency: occasional (UX quality).
- Where: tooltips and `title=` strings, toasts, banners, dialogs, empty states, inline hints, error copy across `apps/web`. EXEMPT: LLM prompt text, dev logs, code comments, schema `.describe()`, internal enum strings.
- Example: a two-line tooltip that could be four words; `Falló la importación — reintentá más tarde`; correct-but-cold copy that reads unlike the tone used elsewhere in the product; "conviene vender" (advice) instead of describing the position.
- Fix: cut to the fewest words that still read as a complete thought; NO em dashes; write for a retail investor (investing terms are fine, never internal or technical lingo — see `[user-facing copy speaks the user's language, not engineering]` for the vocabulary line); describe, never recommend; frame it to land the reaction we want (calm, in control, reassuring) rather than merely stating a fact; match the voice already used on nearby surfaces so the app reads as one product.
- source: user directive (product-copy voice).

**[user-facing copy — navigable destination not linked]**
- Pattern: copy names a place the user must go to act (a settings page, "importaciones", "deudas") as plain text on a surface that CAN render a link (JSX/markdown) — no clickable link to the route.
- Frequency: occasional (nit-class, but a real UX gap).
- Where: React/JSX callouts, dialogs, banners, error panels; rendered markdown. EXEMPT: native `title=`/tooltip attributes and the plain strings that feed them (a title cannot carry a link) — keep the wording, add the link at the JSX surface instead.
- Fix: wrap the destination phrase in a link to the exact route (e.g. `<Link href="/settings">ajustes</Link>`); if two surfaces state the same block, share one linked component rather than restating the copy.
- source: reviewer nit.

**[data exposure / audit logging / telemetry leaks / inbound callbacks]**
- Pattern: server-only fields (tokens, secrets, service-role results, another user's rows) reaching client payloads or a widened `select *`; `outcome:"success"` audited before the op runs / missing `user_id` / unaudited deny paths / an UPDATE or DELETE on the append-only `audit_log`; amounts, holdings, CUIT/DNI/CBU, tokens, or extracted JSON in logs, spans, PostHog events, or error messages; an inbound callback (e.g. `/api/inngest`) served without signature verification.
- Frequency: occasional, high-sev.
- Where: response payloads, `audit_log` emission sites, logger/span/PostHog call sites, error handlers that echo input, route handlers receiving callbacks.
- Fix: strip server-only fields; audit after the op with the correct `user_id` + action taxonomy + deny paths, insert-only; log ids and counts, never values; scrub before PostHog; keep Inngest signing-key verification on and reject replays.
- source: senior Pass-2.

## Emerging
<!-- Advisory / weaker-signal classes land here (single-PR or unconfirmed signal). Auto-appended by a catalog-calibration pass. Graduate to Curated on confirmation + frequency >=2 distinct PRs. -->

## Known false-positives — never raise
<!-- Negative signal. These shapes are correct as written; raising them wastes a finding. Pre-filters both sections above. -->
- A to-many embed does not duplicate parent rows — `(entry_date, id)` on the parent PK IS a total order; a tiebreak is needed only for a `RETURNS TABLE` RPC projecting a real JOIN.
- `CREATE OR REPLACE FUNCTION` preserves the ACL — do NOT flag a missing re-GRANT; only a fresh CREATE or DROP+CREATE resets EXECUTE to PUBLIC.
- The JSON string `"now()"` coerces fine to timestamptz via PostgREST.
- Radix uncontrolled `Select` updates its own displayed value — `defaultValue` isn't automatically a bug.
- Supabase `SIGNED_OUT` is a precise "session removed" signal — a global reset listener on it is correct, not noisy.

<!-- AUTO-APPEND:END -->
