---
name: auto-ship-gate
description: >-
  Drive ONE already-pushed PR through the automated gate to merge-ready: pre-flight (linked Linear
  issue, PR conventions, conflicting PRs, migration checks), then loop the review bots (Cursor
  Bugbot, codex — whichever are installed) to green on the latest head, await CI, confirm mergeable. `adv-review` is the
  human-style review; this is the bots-and-CI gate. Use for "run the bot/CI gate", "push and loop
  bugbot to green", "is this PR ready to ship", "check the PR is linked to Linear", "any conflicting
  PRs", "drive this PR to mergeable", "wait for bugbot then CI", "auto-ship-gate PR NNN". Plant
  monorepo (Plant-PPP/plant).
---

> ⚠️ **Autonomous orchestrator — use with human oversight.** This skill runs multiple phases largely unattended (it may fan out subagents and push commits). Prefer it for smaller, well-scoped, lower-risk changes, and review its output before merging. It stops at merge-ready — it never merges.

# Ship Gate — the bots-and-CI review

You are driving a single PR through the automated gate that runs AFTER a human/adversarial review has already fixed the code: the review bots installed on `Plant-PPP/plant` (Cursor Bugbot, and codex — which posts threads but publishes no check — whichever are installed) plus CI/CD. If no review bot is installed, step 1 reduces to "zero unresolved bot threads" and the loop is effectively CI-only; every other rail still binds. Think of it as a third reviewer alongside `adv-review` (both paths) — except this one is asynchronous and lives on the remote, so it is a **loop**, not a pass. First a static pre-flight manifest (Phase A) gates entry to the loop.

## Autonomy

> **Runtime:** where a step says "spawn a wave" / "fan out subagents" (`Task`/`Explore`), that assumes a runtime with parallel sub-agents. For the tool-neutral contract and the sequential fallback (Cursor/Codex: run the passes serially, same lenses/gates/floors), see `.claude/skills/_shared/runtime/capabilities.md`.
**Run end-to-end, fully autonomously. Do not check in.** Make the calls yourself; surface something
only when it is a genuine product decision or a hard block you cannot resolve (a red CI job you can't
reproduce after real effort, a bot finding that is a real bug outside this PR's scope needing its own
PR). **MODE CHECK — do this first.** Read `.claude/skills/_shared/night-shift/detect.md` and follow it (`cat "<your scratchpad>/night-shift.state"` — substitute your real scratchpad path from your system prompt; `$SCRATCHPAD` is **not** a set variable, and **do not add `2>/dev/null`** — both turn a broken read into a confident, wrong `OFF`). If it records `night-shift: ON`, its **RULE ZERO** additionally overrides every remaining
consent gate and check-in line in this file, including the sentence above — but it overrides no rail. `## Non-negotiable ordering`, the "Always" bullets in step 6 (never merge,
never dismiss a reviewer's CHANGES_REQUESTED) and every cap in this file (the ~6 head-cycle / ~4
round caps — stop at them and log, never loop past) are where most of them are written down; that
list is illustrative, not exhaustive, and when in doubt it is a rail.

⚠️ **On ANY exit — precondition, cap, `FAILED`, refusal or success — if the state file's `run:` names this skill, clear the mode BEFORE reporting: `printf 'night-shift: OFF\n' > "<your scratchpad>/night-shift.state"`. An early exit that skips this leaves the user's next command running with no consent gates.

⚠️ **Never give a read-only `Explore` agent autonomy** — no doctrine paste, no "decide and proceed": its contract is to report upward, it holds `Bash`, and telling one to act is how a read-only agent becomes a writing one.

## Non-negotiable ordering (the whole point of this skill)

1. Review bots green on the **LATEST head** comes FIRST — every bot, not just Bugbot.
2. **Only after** the bots are green do you look at CI/CD.
3. **Only after** CI/CD is green do you re-query the bots one last time, then confirm mergeable and (optionally) request review.

Never check CI while a bot is still pending or has open findings. Never call a PR merge-ready while any check is pending. **Every fix you push resets the loop to step 1** — a new head means the bots re-review and CI re-runs; you re-await both.

## Preconditions

⚠️ **FIRST: the PR must be YOURS.** Resolve your own identity — `gh api user --jq .login` — then
`gh pr view <n> --json author --jq .author.login` and compare. If they differ, **this skill is read-only from here: report what you found and stop.** No `gh pr ready`, no
push, no comment, no thread resolve, no merging staging in. Every one of those is mandated
unconditionally below, and every one is irreversible on someone else's work: marking someone else's
draft ready (a contributor's, a bot's) fires reviewer webhooks that cannot be un-sent, and resolving their thread silences them.
The mandates in this file are written for a PR you own; ownership is the precondition that makes them
safe. ⚠️ **Re-run this check after any compaction relaunch**, before touching the loop — a relaunch
can re-enter mid-file and would otherwise never have read this section.

- The PR exists, the branch is pushed, and the working tree matches the pushed HEAD (`git status` clean, `git log -1` == `origin/<branch>`). If not, push first.
- Know the PR number and the latest head SHA (`gh pr view <n> --json headRefOid`).
- The code has already been through its correctness review (`adv-review`/adv-research). This skill does not re-review the code from scratch; it runs the pre-flight manifest, then processes what the bot and CI say about it.

## Phase A — pre-flight manifest (MANDATORY, before the loop)
1. Read `.claude/skills/_shared/pr-readiness/manifest.md` in full now — that path resolves against the REPO ROOT, not your cwd.
2. A5's migration check is ORCHESTRATOR work — a local Supabase/docker run and any PR comment are forbidden to a subagent, so do it yourself rather than handing it to the wave.
3. Execute A1–A6 against the current PR head, adversarially verifying every finding (≥6 `Explore` subagents, pasting `.claude/skills/_shared/subagent-constraints/hard-constraints.md` + `.claude/skills/_shared/subagent-constraints/working-location.md`).
4. Mark the PR ready-for-review (`gh pr ready <n>`) once the manifest is clear — this is the DEFAULT, no authorization needed. Do it here, not at the end: a workflow or bot that skips drafts (a job-level `if: !github.event.pull_request.draft`, a bot configured to ignore drafts) never runs on a PR that stays draft through the loop.
5. NEGATIVE GATE: do NOT proceed to "The loop" until you have Read the manifest and **cleared** every BLOCKING item. A
   BLOCKING item that cannot clear does not enter the loop — attended or not. ("Surfacing" it is how
   you report it, not a way past it.) A malformed PR (unlinked issue, missing Intent, unresolved migration/conflict) does not enter the bot loop. Re-run only the affected manifest item after a later push.

## The loop

### 1. Trigger + await the review bots on the latest head
- Bugbot usually auto-runs on push. If its check is missing or you want a re-run on the current head, post a `bugbot run` PR comment.
- **SETTLE RULE.** Green on this head = a `Cursor Bugbot` run that actually REVIEWED it has completed, no run is in flight, ~90s have passed since it completed, and zero unresolved threads from ANY review bot. Posting `bugbot run` starts a NEW run — re-await it rather than carrying the old verdict.
- Four ways a naive read calls that green when it isn't:
  1. **The run reviewed nothing.** A push — or a `bugbot run` comment — cancels the in-flight run, which still completes as `conclusion: neutral` and blames "a new commit" either way. Discriminate on `output.summary`, not the conclusion — but not on its opening either, which is always a progress log. Match the verdict line: `**Final Result:** Bugbot completed review …` (it reviewed; read on for `and found N potential issues` vs `- no new issues found`) vs `**Result:** Bugbot run cancelled …` (it reviewed nothing). A real review that found issues also concludes `neutral`, so `gh pr checks` printing `neutral` as the bucket `skipping` is not a pass.
  2. **Wrong run.** `gh pr view <n> --json headRefOid`, then `gh api "repos/Plant-PPP/plant/commits/<sha>/check-runs?filter=all&per_page=100"`. The default `filter=latest` hides the earlier run. An ABSENT run is not a pass either — seconds after a push there is nothing to wait on yet.
  3. **Only one bot.** `cursor` is not the only reviewer — `chatgpt-codex-connector` posts threads too, and it publishes NO check-run, so nothing gates on it. It has been observed posting ~70s after Bugbot's run completed on the same head.
  4. **Truncated thread list.** Query `last:100` — the newest window, since fresh findings are what you're hunting — and compare `totalCount` against what you got. A busy PR can reach dozens of threads; past 100, paginate rather than accepting the truncation.
- Fetch every unresolved bot thread on the PR (the query is not head-scoped — the head binding comes from the run, above):
  ```
  gh api graphql -f query='{ repository(owner:"Plant-PPP",name:"plant"){ pullRequest(number:N){ reviewThreads(last:100){ totalCount nodes { id isResolved isOutdated comments(first:1){ nodes { author{login} body path line } } } } }}}'
  ```
  Filter `isResolved==false` and `comments.nodes[0].author.login` in (`cursor`, `chatgpt-codex-connector`). Do NOT filter on `isOutdated` — that only means the thread's diff anchor moved, so it drops findings nobody addressed.
- Cap the whole gate at ~6 head-cycles, and ~4 rounds on any single unchanged head. Past that the bots are not converging: surface it instead of looping on.

### 2. Adversarially verify EACH finding before touching it
A bot finding is a claim, not a verdict — treat it exactly like a human reviewer's comment. Per the standing rule: **any PR finding (bot or human) → run an adv-research wave (≥6 independent read-only subagents) to confirm/refute BEFORE fixing.** Spawn those subagents as the `Explore` agent type (read-only toolset) and paste `.claude/skills/_shared/subagent-constraints/hard-constraints.md` + `.claude/skills/_shared/subagent-constraints/working-location.md` at the top of each prompt — a prose "read-only" line is not a hard constraint. Do NOT blind-apply the bot's suggested patch. In the wave, split into "prove it real" and "prove it wrong / find the correct convergent fix" lenses; a finding survives only if it converges. This is how you catch a bot that is right about a symptom but wrong about the fix — and a bot flagging code YOU changed this session (verify against the established convention/sibling code, not just the bot's prose).

For each finding, decide from the convergence:
- **Real + in-scope + boyscout-safe (small, no behavior change to shared/live code, no own-test/PR needed):** fix it inline.
- **Real + in-scope but non-trivial:** fix it (it's this PR's job).
- **Real but out-of-scope / needs its own test or PR:** DON'T force it in. File a Linear follow-up (team Plant, key `PLA`, written in Spanish) and reference it in the reply.
- **Not real (refuted by the wave):** don't change code.

Then **reply on the thread** with the outcome (fixed in <sha> / why deferred to PLA-NNN / why refuted), and **resolve the thread** (`resolveReviewThread` mutation with the thread node id) — ⚠️ **bot
threads only** (`cursor`, `chatgpt-codex-connector`). A human's thread is never resolved and never
replied to by this skill; resolving it silences them irreversibly and `nav-github`'s rail on speaking
to people stands under the mode. Bugbot often auto-resolves its own outdated threads after a fixing push — re-query; only resolve what's still open.

### 3. Push the fixes → back to step 1
Commit (one-line message per CLAUDE.md), push, and return to step 1: the new head triggers a fresh bot review. If every finding was refuted or deferred there is nothing to push — reply + resolve, then re-apply the settle rule on the unchanged head (counting toward its cap) rather than pushing an empty commit. Keep looping until the bots are **green on the latest head per the settle rule**.

### 4. Only now: await CI/CD green
- `gh pr checks <n>` — wait until no check is `pending`.
- **DID-NOT-RUN check.** Nothing pending is not the same as CI having run. A workflow that triggers only on `branches: [staging]` shows a PR based on another branch an instantly-clean board with **no row at all**; a job that skips drafts via a job-level `if` shows as a present `skipping` row rather than an absence. Neither is a green. List every required check that did not actually run, with the reason — and where that reason is structural (wrong base, unmatched `paths:`) it is NOT a blocker: record it, and never wait on a check that cannot run. But "it didn't run" is not "it would have passed". A draft-skipped check should no longer happen — Phase A marks the PR ready — but if you see one, the PR slipped back to draft: re-run `gh pr ready` and re-await it rather than letting the skip stand in for the check.
- A red CI job: read the actual failing job log (`gh run view --log-failed` or the job URL), reproduce locally, fix, push → this is a new head, so **go back to step 1** (bot re-reviews the fix too).
- Ignore-list the always-noisy non-required checks (e.g. `Vercel Preview Comments`) — gate on the required set (`gh pr checks <n> --required`: the CI workflow, `Cursor Bugbot` if installed, the Vercel preview deployment of `apps/web`), minus whatever the DID-NOT-RUN check showed cannot run on this PR.

### 4b. Final bot re-query
Re-run the step-1 thread query once more here, before mergeable — CI's run is dead time in which a re-run or a second bot can have posted. Anything new is a finding like any other: run step 2's verification wave first. Then:
- Fixed with a push → new head → **back to step 1**.
- Refuted or deferred, so no new head → reply + resolve, then re-apply the settle rule (counting toward its cap); clean → step 5. Don't re-run the whole loop for a head that never changed.
- Nothing new → step 5.

### 5. Confirm mergeable
- `gh pr view <n> --json mergeStateStatus,reviewDecision`.
- `DIRTY` = conflict with base: merge `origin/staging` in and resolve (mind the hazards:
  keep-both conflict resolutions, migration timestamps that now sort before staging's), re-verify tests, push →
  **back to step 1**. ⚠️ **Unattended, resolve only a conflict you can settle mechanically.** A
  resolution that needs judgement — overlapping hunks, anything in a migration or money-math path —
  is a `FAILED: PR <n> conflicts with staging — <files>`: stop that item, leave the branch as it is.
  A dropped hunk is exactly what a diff-anchored bot will not flag, and the run would then report
  green on a gate nothing certified.
- `BLOCKED` with all checks green means a branch-protection rule on `staging` still binds (e.g. branch out of date with base → update it and go back to step 1) or a human left a `CHANGES_REQUESTED` that still stands. Plant has no required approvals, so a missing approval is not the cause. A standing `CHANGES_REQUESTED` is NOT yours to clear by dismissing it.

### 6. Request review, or stop — per guidance
- Plant is a single-developer repo: no CODEOWNERS, no required approvals, no review rotation. Re-request a reviewer (`gh pr edit <n> --add-reviewer <handle>`) only if the caller said "request review" or a human left `CHANGES_REQUESTED`.
- Otherwise stop at green+mergeable and report. Confirm the PR is still ready-for-review (not draft) before reporting.
- **Always:** never click merge, and never dismiss another reviewer's `CHANGES_REQUESTED` to bypass them. Merging is the human's call. Bringing the PR to "everything addressed + green + ready (+ re-requested, where step 6 applies)" IS the deliverable.

## Waiting (don't burn tokens polling)

CI runs several minutes; bugbot ~3 min. Don't sit in a foreground poll. Launch a background `Bash` loop that polls every ~30s and **exits** when what you're waiting on is done — a completed background command re-invokes you. For the bot-await, poll the head's `check-runs?filter=all` (NOT `gh pr checks`, which collapses to the latest run and hides the one you need) and exit ~90s after a run that actually reviewed the head completed with nothing in flight. Then count open findings from the step-1 GraphQL query with `jq '[.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved==false and ((.comments.nodes[0].author.login? // "") | IN("cursor","chatgpt-codex-connector")))] | length'`. A jq error (rate limit, `errors` in the payload) is not a zero read — check the exit status before trusting the count. For CI, `gh pr checks <n>` is the right call: exit when `ci != pending`. Read the tiny output file for the result. If you must self-pace instead, prefer 270s (cache-warm) or 1200s+ (one cache miss buys a long wait); never 300s.

## Output

At each gate transition (`gate:invoked` → bot head-cycle → CI → mergeable), update the driven PR's
row in the run's living master plan if one exists (`.claude/skills/_shared/execution-plan/master-plan-format.md`)
— the bot head-cycle count (of ~6), CI state, and mergeable — and echo the transition, so a cold
reader sees exactly how far the gate got.

⚠️ **If the mode was ON and the state file's `run:` line names THIS skill, you are the
top-level run — clear it BEFORE this report** (`_shared/night-shift/detect.md` § Ending the mode owns
this; `run:` is the test, not your recollection of who invoked you):
`printf 'night-shift: OFF\n' > "<your scratchpad>/night-shift.state"` (your real path). The mode
covers one top-level invocation; leaving it set means the next thing the user types in this session
runs with its consent gates suppressed while they are sitting there.
⚠️ **If you were invoked BY another skill, do NOT clear it** — that run is still going and needs the
mode. Clearing it mid-pipeline silently re-arms every consent gate for the phases after you.

End with a compact status: head SHA, bot verdict (green / N findings → fixed M, deferred K), CI verdict (all green / which job red / which required check never ran and why), mergeStateStatus, reviewDecision, any follow-ups filed, and the single remaining human action if any (e.g. "merge the PR into `staging`").

⚠️ **Emit the RECEIPT — three artifacts, verbatim, not summarised.** Your caller reports merge-ready
only by passing these through, and cannot re-derive them without becoming a second, ungoverned gate:
1. the head SHA the verdict is bound to, 2. the `check-runs?filter=all` result on that SHA,
3. Bugbot's `**Final Result:** …` line. A verdict with no receipt is the claim this gate exists to
replace.
