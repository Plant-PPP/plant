# Comment-value calibration — hand-labelled exemplars

Plant-shaped comments, labelled by the `enforce-comment-value` classifier. The paths are where such a
comment would live in this monorepo (`apps/web`, `packages/*`, `supabase/`), not citations of existing
lines — replace them with real hand-labelled comments from this repo as the codebase grows. Read before
a first pass, and whenever a verdict feels uncertain. A lens edit that flips a label here is a
regression — fix the lens, not the label.

## DELETE — Q1: derivable within one screen

| Where | Comment | Why |
|---|---|---|
| `packages/core/.../holdings.ts` | `// Update existing holding` above `if (existing) { const updates = {…} }` | The branch and the variable both say it. |
| `apps/web/.../import-review-store.ts` | `// Reset selection` above `this.selectedRowIds.clear(); this.cursor = 0` | Restates two self-naming statements. |
| repo-wide | `// Get current user` above `getCurrentUser()` | Pure echo. |
| `packages/sources/__tests__/file-upload.test.ts` | `// 1. parse the CSV  // 2. map the rows` … numbered running commentary | REFACTOR-INSTEAD when it narrates production logic; DELETE in a test whose steps are already one call each. |

## KEEP + ANCHOR — Q2: unrecoverable from this repo

| Where | Comment (abridged) | Why it pays |
|---|---|---|
| `packages/sources/.../file-upload/parse-statement.ts` | `REQUIRED: every holding row carries its currency. Validate at the boundary so a missing currency fails LOUD instead of defaulting to ARS and silently mis-valuing a USD position.` | External-format contract + a named hazard + why the validation is where it is. Nothing in the code says ARS is the silent default. Textbook anchored KEEP. |
| `packages/jobs/.../import-steps.ts` | `Chunk the cleanup too: it runs its own unchunked .in("id", …) and swallows errors, so >~100 ids overflow the querystring and silently skip cleanup, leaking uploaded files in storage.` | Failure mode of a *callee* + a silent-data-loss consequence. Deleting this loses the only record of why the loop exists. |
| `packages/shared/.../decimal.ts` | `Strict shape … parseFloat alone is too lenient ("1.234,56abc" -> 1.234), so guard the whole string before parsing.` | Explains why the regex is not redundant with the parse — exactly the line a competent reader would otherwise "simplify" away. Passes the bug-filing test. |
| `packages/sources/.../extraction.ts` | `The model rejects documents with more pages than this, so split the caller's PDF before forwarding it.` | External-service limit behind a magic number, with the direction of the constraint. |
| `packages/sources/.../consensus.ts` | `… raising it tightens; lowering it accepts weaker agreement between extraction runs.` on `MIN_CONSENSUS_RATIO = 0.6` | Load-bearing constant rationale + which way to move it. Keep-and-anchor: it should name the tuning signal, not just the direction. |

## REWRITE — right fact, wrong form
- `apps/web/.../net-worth-card.tsx` — `// Fetch valuation from the server (skeleton shows while this
  runs)`. The first clause restates the call below it; the parenthetical is the non-obvious half.
  Verdict is REWRITE to `// skeleton shows while this runs`, NOT delete. A comment that is part noise
  is rewritten to its load-bearing clause, never dropped whole.
- A KEEP that restates a constant's **value** instead of its **name**: `// stale after 5 minutes` will
  drift the moment `MEP_RATE_STALE_SECS` changes. Reference the name.
- A `TODO` with no ticket: `// TODO: handle the retry case` → REWRITE with an issue reference
  (`PLA-<n>`), not DELETE.
- Three sentences of preamble around one load-bearing clause → cut to the clause.

## HOIST
- The same "the MEP rate used is the sell-side quote" note repeated at sibling call-sites → once, on
  the shared definition.
- A per-line note describing an interface's contract → onto the interface (e.g. `PortfolioSourcePort`).

## Low priority — leave unless doing a full-file pass
`// ========` dividers, `// Constants`, `// Handlers`, `// Zod schemas`.
They make no claim, so they cannot rot. They are noise, not liability — never spend review attention
on them.

## Never touch
`// eslint-disable-next-line @typescript-eslint/no-explicit-any` · license headers · shebangs ·
public-API JSDoc · test-intent comments and expected-value arithmetic (e.g. in a valuation test,
`// 100 nominals × 1.05 USD × 1,200 ARS/USD = 126,000 ARS` is the proof of the assertion) · anything in
the generated Supabase DB types or `supabase/migrations/`.
