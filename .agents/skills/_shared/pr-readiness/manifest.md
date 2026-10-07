# PR-readiness manifest (auto-ship-gate Phase A pre-flight)

Run ALL of A1–A6 once against the current PR head BEFORE entering the bot/CI loop. Re-run only the
affected item after a later push. **BLOCKING** = must clear, or the PR does not enter the bot/CI loop — attended, STOP and surface it
to the human; unattended, "surface" has no destination, so log it, mark the item
`FAILED: <item> — <reason>`, and keep working every track it does not block
(`_shared/night-shift/detect.md`). Either way the loop does not start. **ADVISORY** =
record + reply, do not block. Adversarially verify every finding with a ≥6-subagent `Explore` wave
(paste `.claude/skills/_shared/subagent-constraints/hard-constraints.md` + `.claude/skills/_shared/subagent-constraints/working-location.md` into each prompt) before
any fix. The only sanctioned writes **in A1–A6** are additive metadata (A1 attachment, A4 Intent prepend);
never merge, dismiss a review, or rename an open PR's branch (that closes the PR).
⚠️ **Marking ready-for-review is NOT banned — it is the caller's next step, not one of these items.**
`auto-ship-gate`'s Phase A mandates `gh pr ready` unconditionally once this manifest is clear, and it
must happen: any CI job gated on ready-for-review (a job-level `if` on draft state) is skipped while
the PR is draft, so leaving it draft silently disables that check and reports a `skipping` row as if
it were green.

## A1 — Linked Linear issue        [BLOCKING]
Extract the key from the branch (`PLA-<n>`, case-insensitive, e.g. `feat/pla-12-job-runner`).
`mcp__linear__get_issue{id}` — the link is authoritative ONLY via `issue.attachments[]` containing
this PR's `github.com/Plant-PPP/plant/pull/<n>` URL. NOT `linkedIssues[]` (integration-populated,
often empty). If the attachment is missing:
- branch carries the key and resolves to exactly ONE issue → `mcp__linear__save_issue{id, links:[{url,title}]}`
  (do it; append-only, lands in `issue.attachments[]` — mechanics single-sourced in `nav-linear`
  §Linking mechanics; `create_attachment` is a file upload, not a URL attach). Re-fetch to confirm.
- branch has no key / ambiguous → SURFACE (do NOT rename the branch). ⚠️ **A greenfield run should never reach this leg** — `/auto-build` Phase 4 files the issue and
  names the branch from its `gitBranchName` before opening the PR, precisely so this clears. If you
  are here anyway — Phase 4 was skipped, or issue creation failed — **do not file it from here**:
  Phase A's sanctioned writes are additive metadata only. Record
  `FAILED: A1 — no Linear issue for <branch>` (a failed
  gate is `FAILED`, never `AWAITING-HUMAN`), leave the PR pushed and unlinked, and **do not enter
  the bot/CI loop** — the BLOCKING rule above holds. Rename nothing; it closes the PR.

## A2 — No overlapping open issue    [ADVISORY]
ONE narrow `mcp__linear__list_issues` fuzzy pass on terms derived from the changed-file area +
this issue's title; exclude Done/Canceled and the PR's own issue. Judge the top few candidates;
if one looks like the same work, SURFACE it. Never block — this is heuristic and noisy.

## A3 — No conflicting open PR        [SPLIT: blocking for hard tiers, advisory for soft]
ONE call for every other open PR's file set:
```
gh pr list --repo Plant-PPP/plant --state open --limit 200 --json number,headRefName,baseRefName,files,isDraft
```
No `--base staging` filter: a PR stacked on a feature branch is still an open PR that can carry a
colliding migration timestamp, and filtering by base drops it out of the blocking tier entirely.
Intersect each PR's file paths with this PR's (`gh pr diff <n> --name-only`). Only for a SHARED
file, deep-dive with `gh pr diff` and tier it:
- **BLOCKING:** both add a `supabase/migrations/*` file (dup timestamp → apply-order crash) OR same function / overlapping hunks in one file.
- **ADVISORY (merge-order note):** disjoint hunks in the same file, or one PR consumes a shared type the other changes.
Pagination is a false-NEGATIVE risk: without `--limit` gh stops at 30 PRs, and `files` is capped
~100/PR — for a wide PR, confirm migration collisions directly by listing `supabase/migrations/`
across open PRs.

## A4 — PR conventions                [BLOCKING, auto-remedy]
Body starts with `## Intent` (2–4 sentences, whole body <~25 lines); title <70 chars, conventional
(`fix:`/`feat:`), `[DESTRUCTIVE]` prefix for a destructive migration, `(N/X)` prefix for a stacked
set, `(PLA-<n>)` as the last token. Full rules are single-sourced in the `nav-github` skill's conventions section — Read it, do not
restate. Missing Intent → draft it from the diff, run it through `tighten`, and PREPEND it
preserving the rest of the body (do it — additive, draft-safe).

## A5 — Migration apply + DB quality  [BLOCKING, only if `supabase/migrations/` changed]
On a fresh local database (`pnpm db:reset`), confirm every migration applies cleanly in order, the
pgTAP suite in `supabase/tests` passes, and regenerating types (`pnpm db:generate:supabase-types`)
leaves no uncommitted diff, and `bash scripts/check-migrations.sh origin/staging` (name, order,
atomicity, squawk) passes. Run the `enforce-owner-isolation` lens over every policy/grant/function
the migration adds or changes (RLS `user_id = (select auth.uid())` in both `USING` and `WITH CHECK`,
explicit grants to `authenticated` only, nothing to `anon`, `SECURITY DEFINER` with `SET search_path`).
For a new index/FK/RLS/query, also Read the relevant reference file(s) under
`.agents/skills/supabase-postgres-best-practices/` (the index plus only the matched `references/*.md`), and apply any generic PG-perf finding — additive to the defect catalog.

## A6 — Runtime verification evidence  [ADVISORY]
Confirm the change was driven end to end before ship (the implementation ran the real flow — the app
locally, and for job changes an import through the local Inngest dev server — and recorded it, OR CI
includes a real e2e job that exercises the flow — not just unit tests). If neither is present,
SURFACE it (tests-only is how deploy-time breakage slips through); do NOT re-drive the flow from
auto-ship-gate and do NOT hard-block — Phase B CI/CD-green plus the Vercel preview deployment is the
deploy-time real-run proof.
