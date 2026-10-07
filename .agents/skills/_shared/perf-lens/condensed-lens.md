# Condensed algorithmic-performance lens (paste verbatim per subagent)

This is the block review/planning/build skills paste into EVERY subagent prompt (a "see the skill"
reference is inert; subagents inherit only their prompt). There is no separate fat performance
skill in Plant — this file IS the lens; the orchestrator reads it once and pastes the block below.

```
=== ALGORITHMIC-PERFORMANCE LENS (attack every change for cost that scales with total data) ===
On its own `perf-lens loaded:`-prefixed line in the load-proof HEADER BLOCK (header order: catalog,
ports-lens, dry-lens, perf-lens; the tripwire keys on the PREFIX, not on line position), or this wave
is NON-CLEAN and re-run:
  perf-lens loaded: work bounded by page/working-set, not total data | data touches: <table/array list | "none — no query/loop/large-list in diff">
("none" is a CLEAN pass ONLY when stated. A bare "none" or a missing/garbled perf-lens line = NON-CLEAN.
A wrongful "none"/"N/A" on a diff that DOES add a query, a loop over rows, a fan-out, or a large-list
render/matcher is a first-class DEFECT.)

THE ONE LAW: hot-path work must be BOUNDED — its cost may not scale with a table's total rows. Every
growing-table access filters on the owner key (`user_id`) and pages by KEYSET, not offset. Unknown-size
work is paged + resumable + concurrency-capped. Set logic lives in the DB, not an app loop.
("Fast on dev data" is not a pass — size for the heaviest plausible user a year out: years of
imports and valuation history, hundreds of holdings, thousands of transactions.)

GROWING-TABLE RULE (no registry yet — Plant is young; treat every per-user table that grows with
time or activity as large: `imports` and their extracted rows, holdings/valuation snapshots, price
history, `audit_log`, assistant conversation/messages): every access carries `user_id` FIRST and an
index whose leading column is `user_id` (RLS already filters on it — the index must serve it);
history/time-series reads also bound the date range and page by (user_id, as_of/created_at, id).
Global reference tables (prices/FX rates by instrument/date) resolve by their natural key
(instrument, date) — never a scan.
Signal: the `authenticated` role's 8s statement_timeout bounds every PostgREST query; a hot query
near it is the red flag. Inngest steps have their own per-step timeout — work that needs more is
split into steps, not stretched.

THE FIVE CO-EQUAL LAWS — check and REPORT each (an unstated law is UNCHECKED, not passed):
1. OWNER-KEY-PRESENT — every growing-table query carries `user_id` (and is served by a
   `user_id`-leading index); a service-role query in `packages/jobs` carries it explicitly, since
   RLS is bypassed there. Missing it = full scan (and an isolation hole) = DEFECT.
2. KEYSET-NOT-OFFSET — pagination over a large/mutating set uses WHERE (k)>(cursor) ORDER BY k LIMIT n,
   never LIMIT/OFFSET (offset = O(n^2) drain + skip/dup under concurrent writes). One shared keyset
   helper in `@plant/shared` once a second caller exists — never a hand-rolled cursor per call site.
3. NO-FULL-MATERIALIZATION — presence via EXISTS/NOT EXISTS; no DISTINCT+JOIN+GROUP BY / correlated
   LATERAL over a whole-user history before LIMIT; no whole-table read into memory/browser then filter in code.
4. NO-N+1 — no per-row DB/model/price call in a loop (e.g. one price lookup per holding); batch by
   chunked IN(...) / a set-based RPC / a join.
5. BOUNDED-WORK — unknown-size work is paged + resumable (one Inngest step per page/chunk with a
   guarded cursor, so a retry resumes instead of restarting; never one giant step); fan-out is concurrency-capped (semaphore / pull-pool / per-page chunk), never an
   unbounded Promise.all(rows.map)/gather over a whole result; big lists are virtualized and hot lookups
   use Map/Set (O(1)), not nested .find/.filter (O(n^2)); real domain-id React keys, not the array index.

SEVERITY: missing partition key / OFFSET on a large set / whole-set materialization on a hot path /
N+1 / unbounded fan-out or single-statement job over a large table / whole-table-into-memory = HARD
blockers (any one = does not merge). Large single-shot .limit(N) ceiling, a loop bounded by small fixed
cardinality, an O(n^2) matcher over a small-today list = raise-and-downgradable (defer only if
pre-existing AND off this change's hot path; state it, don't default).

ONLY sanctioned exceptions (each on probation, one-line justified):
(a) a user-scoped, statement_timeout-bounded, IDEMPOTENT-RESUMABLE batch/backfill (never a hot path) —
    name the bound; (b) a large single-shot .limit(N) read where the set PROVABLY cannot exceed N —
    name the cap + why bounded. "Small table today" is NOT an exception if it grows per-user/import/day.

FIX every violation in this change. The only deferrable is one off this change's hot path / blast radius
(a pre-existing scan the diff doesn't touch) — RAISE it + file a follow-up, never tolerate silently.

PER-LAW VERDICT: if the change adds/edits a query, a loop over data, a fan-out, a paged job, or a large-
list render/matcher, emit PASS|DEFECT + one line for each of the five laws. If it touches NO such
surface, emit exactly:
  perf: N/A — no data-scaling surface (no query, no loop over rows, no fan-out, no large-list render).
=== END ALGORITHMIC-PERFORMANCE LENS ===
```
