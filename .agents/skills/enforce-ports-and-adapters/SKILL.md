---
name: enforce-ports-and-adapters
description: >-
  The strict enforcement lens for ports-and-adapters / dependency-injection boundaries — shared code
  branching on a concrete implementation, adapter logic leaking outside its adapter, a dependency
  constructed inline instead of injected. Plugs into any review or planning pass. Use for "enforce
  ports and adapters", "check the DI boundary", "no leaking adapters", "is anything branching that
  shouldn't".
---

# Enforce Ports & Adapters — the boundary law

This is a **language guide**, not a workflow. Load it as the lens for a review pass whose
sole job is to prove a change respects ports-and-adapters / dependency injection. The bar
is deliberately unforgiving.

> The port is the boundary *special case* of a shared interface — the seam where a DRY-extraction lands
> on an architecture boundary. The general "when must I extract a 2nd occurrence" law lives in
> `enforce-clean-code`; this guide owns placement/naming/DAG once the seam is a boundary.

## The one law

**Adapter-specific logic lives ONLY inside its adapter, behind the shared contract. Nothing
else in the codebase — end to end — may know which concrete implementation is in play, and
nothing else may branch on it. Everything flows through the port.**

- The **port** is the shared contract (an interface / injected dependency / typed seam).
- An **adapter** is one concrete implementation of that port, injected at call time.
- Consumers (handlers, tests, components, helpers, scripts, seeds — *everything*) talk to
  the **port only**. They receive the adapter by injection and never construct, import, or
  name a concrete one.

## The four co-equal laws

This lens enforces FOUR laws. All four must be CHECKED and REPORTED on every change — a law
you did not mention is UNCHECKED, not passed. They are co-equal in scope; they are severity-
tiered only for what blocks a merge:

1. **No-branch** — nothing outside an adapter branches on the concrete implementation.
2. **Placement** — the thing lives where the sibling hexagon puts it (Placement law).
3. **DAG-direction** — every first-party import points strictly downward (Repo hierarchy).
4. **Contract-vocab** — the core speaks only the contract's words (Naming law).

HARD blockers (any one = the change does not merge): a branch on the concrete impl; adapter-
specific code in shared/consumer code; a dependency constructed inline; reaching past the
port; an import pointing up/sideways in the DAG; a **provider/adapter name or coined word
leaked into a core identifier, file, shared type, or comment** (a boundary leak, not cosmetics).

RAISE-and-downgradable (a defect, always reported; may drop to a tracked follow-up only if
pre-existing AND purely cosmetic, stated not defaulted): a **version/lineage marker** in a name
(`v2`/`old`/`legacy`/`base`/`generic`), or an invented parallel term where a house term exists,
when it leaks nothing about a concrete implementation.

When applied via a subagent wave, this lens is delivered as the condensed block at
`.claude/skills/_shared/ports-lens/condensed-lens.md` (pasted per subagent), which carries the
load-proof echo (`ports-lens loaded: … | touched packages: <list|none>`; missing = NON-CLEAN)
and the per-law verdict contract (four verdicts if a port surface is touched, else one
`ports: N/A` line). This file is the orchestrator's full reference; the condensed block is what
reaches each subagent.

## What is FORBIDDEN — remove on sight, do not tolerate

Every violation below must be FIXED in this change. The ONLY thing you may defer is a fix that is
*literally unexpressible* today (the seam does not yet exist) — and even then you must RAISE it and
file a tracked follow-up (Linear), never silently tolerate it. "Hard to fix", "out of scope", "the
architecture makes it awkward" are NOT exemptions. A pre-existing violation outside this change's
blast radius is still RAISED + logged as a follow-up; it does not block this PR, but it never
disappears.

1. **A branch on the concrete implementation anywhere outside an adapter.** `if (isKindX)`,
   `provider === "..."`, `flavor === "..."`, a ternary that swaps behavior by variant, a
   `switch` over implementation types in shared code — ALL are defects. The code must NEVER
   EVER branch on which adapter it is. If two implementations differ, that difference is the
   adapter's job to encode behind the port; the consumer sees one uniform contract.
2. **Adapter-specific anything living outside the adapter.** Even the smallest thing — a
   component, an inline expression, a one-line helper, a test seed literal, a fixture tweak,
   a default value chosen for one variant — must not sit in shared/consumer code. If it is
   specific to one implementation, it belongs in that implementation's adapter, full stop.
3. **A dependency constructed inline instead of injected.** `new ConcreteAdapter()` /
   `makeX()` reached for directly by a consumer, a hardcoded singleton, a module-scope
   concrete instance, a direct import of a concrete adapter class where the port should be
   passed in. Inject it; never inline it.
4. **Reaching past the port.** A consumer (especially a test) that hand-rolls storage
   access, raw SQL, private internals, or any side channel the port does not expose — to
   "just get the data" — has broken the boundary. All data enters and leaves through the
   port.
5. **A comment that references what its file must know nothing of.** In-line comments obey
   the same law as code: a shared/consumer file's comments must not name a concrete adapter,
   describe one variant's private shape, or explain a branch that should not exist. If the
   comment has to mention the implementation, the code is already leaking. Comments stay
   short and stay inside the contract's vocabulary.

## The ONLY sanctioned exception

A genuine, product-level dual/multi contract that the **port itself declares** — i.e. the
output/input shape is legitimately variant because the real product ships it that way, and
the consumer is asserting the port's own declared bifurcated behavior, not smuggling in
implementation knowledge for convenience. This exception is narrow:

- Knowing an **output field is nullable/variant per the contract** = allowed.
- Branching to **fake or reconstruct behavior the port does not actually expose**, or to
  make an assertion merely "pass for both", = FORBIDDEN.

Every use of the exception is on probation and must, in one line, state BOTH: (1) the exact port
field that DECLARES the variance (the contract's own nullable/variant surface), and (2) the death
condition — the event on which it must be deleted (the day the contract unifies). Missing EITHER of
the two = defect, not exception. A variance the port does not itself declare is smuggled
implementation knowledge; treat it as a hard blocker, never as license.

## Placement law — the boundary is physical, not just logical

Correct behavior in the wrong file is still a defect. Where a thing LIVES is part of the
contract. This is as strictly enforced as the no-branching law.

1. **Mirror the nearest existing hexagon EXACTLY — never invent a shape.** Before adding a
   port or adapter, find the sibling ports-and-adapters module already in the repo and copy
   its skeleton: same directory for the contract, same `adapters/<provider>/` layout, same
   barrel/index structure, same file-casing. A new folder shape, a novel file name, or a
   "dumped" file next to unrelated code is a defect even if it compiles. The codebase has one
   house form; grow it, do not fork it.
2. **The port lives in the contract layer; adapters live under `adapters/<provider>/`.** The
   shared interface sits in the repo's contract location (e.g. a `contract/` dir with a
   `port.ts`), never inside any adapter and never at a consumer. Each concrete implementation
   lives wholly inside its own `adapters/<provider>/` folder — nothing of it leaks up.
3. **Placement follows dependency direction and infra weight.** An infra-free domain package
   (deps deliberately minimal) must NEVER gain an infra dependency (Supabase client/HTTP client/queue/
   filesystem/etc). An adapter that carries infra belongs at the **composition root that owns
   that infra** and is injected into the domain through a **driven port** (an injected seam
   like `config.fetch`). Putting an infra-bearing adapter inside a deliberately infra-free
   package — even behind a clean interface — is a placement defect: it poisons the package's
   dependency graph. In Plant: `shared` takes no infra at all, and `sources`/`core` steps take no
   engine import. Verify the target package's declared deps before you place code in it.
4. **The composition root is the only place that wires concretes together.** Singletons,
   Supabase/Inngest client construction, `new`-ing the adapter, choosing timings — all live at the root
   (`apps/web`), never in the domain or contract.

## Naming law — the core speaks only the contract's vocabulary

Names are load-bearing. A leaked word is a leaked boundary.

1. **The interface is `<Domain>Port`; the file/dir mirror the house convention.** The repo's
   reference contract is `PortfolioSourcePort` in `packages/sources`; a new hexagon names its
   contract in the same location and exports `<Domain>Port` — identically. (`JobRunner` is the
   established name of the jobs port; keep it, do not coin a third form.) Do not coin a parallel
   term ("Policy", "Config", "Manager", "Service") for the same role when a house term exists.
   Mirror the language COMPLETELY: interface suffix, variable names, barrel comments.
2. **The generic core uses ONLY contract words — never a term coined for one adapter.** The
   port, engine, and wrapper's identifiers, variables, and comments must read in the domain's
   own vocabulary (`port`, the domain nouns). A word invented to describe one provider's
   flavor must not appear in the shared core, even as a variable name or comment aside.
3. **A provider/implementation name appears ONLY inside that provider's adapter folder.**
   Never in a core identifier, a core file name, a shared type, or a shared comment. The core
   must be greppably blind to every concrete name (`inngest`, `file_upload`, an AI provider, a
   broker). (Real product identifiers the port itself
   declares — enum values, live URLs — are exempt, exactly as the code-vocabulary rule allows.)
4. **Name by what a thing IS — no version/lineage markers.** No `v2`/`old`/`new`/`legacy`/
   `next`/`base`/`generic` in identifiers, files, dirs, or comments. The generic core is not
   "generic-x"; it is the port and its mechanism. Rename on sight.
5. **Concrete adapter named for its provider + domain, in the module's file-casing.** Mirror
   how sibling adapters name their implementation (e.g. `adapters/file_upload/` in `sources`,
   the Inngest adapter in `jobs`); do not improvise a random file name.

## Repo hierarchy, ownership & boundaries (Plant monorepo)

The abstract laws above are enforced against a **concrete package DAG** (pnpm + turbo). Dependencies
point strictly downward; a package may import only packages BELOW it. An edge pointing up or
sideways where none exists below is a boundary defect. This is the ground-truth graph — use it
verbatim, do NOT invent a cleaner-but-false one.

### The dependency DAG (allowed directions)

```
leaf:       shared  (@plant/shared)          (depends on NO internal package)
domain:     sources (@plant/sources) → shared
            core    (@plant/core)    → shared          (sources and core are mutually blind peers)
orchestr.:  jobs    (@plant/jobs)    → { sources, core, shared }
app:        apps/web                 → { jobs, core, sources, shared }   (composition root)
off-spine:  evals                    → may import packages; NOTHING imports evals
            security-tests           → shared; NOTHING imports it
```

- **`shared` is the leaf and is deliberately infra-free** — pure types and pure functions
  (`pricing.ts`, `ai-cost.ts`, `prompt-text.ts`, generated DB types). It must NEVER gain a runtime
  infra dependency (Supabase client, HTTP client, Inngest, an AI SDK) and never knows a consumer.
- **`sources` is the reference hexagon.** `PortfolioSourcePort` (the zod contract), a single
  `SourceError` carrying `retryable`, a capability matrix, a factory, and the `file_upload` adapter.
  Every new port copies this skeleton.
- **`core` is pure domain** — valuation and portfolio functions consumed by both the UI and the
  assistant. It knows nothing about where holdings came from (no `sources` edge) and nothing about
  how work is scheduled (no `jobs` edge).
- **`jobs` owns the `JobRunner` port** (`startImport`, `cancelImport`) and its Inngest adapter: thin
  Inngest orchestrators that call steps. **Steps are pure functions in `sources`/`core` with no
  engine imports** — the orchestrator is the only code that knows Inngest exists. Job state lives in
  the `imports` table; the UI follows it over Supabase Realtime, never by asking the engine.
- **`apps/web` is the composition root** (Next.js App Router). It is the only place that wires
  concretes together: it constructs the `JobRunner` adapter, hosts the Inngest endpoint
  `/api/inngest`, and hosts the chat route handler. UI components and server actions receive the
  ports; they never name Inngest or `file_upload`.
- **`evals` is a leaf consumer** (in-degree 0). It may drive `sources`/`core` through their ports; a
  package depending on `evals` is a defect — it would pull eval fixtures into a shipped package.
- **`security-tests` is a leaf consumer** too: it reads `shared`'s generated types and talks to
  PostgREST over HTTP. A package depending on it is a defect.
- **No cycles, ever.** An external SDK in a package (e.g. `inngest` in `jobs`) is an external dep, not
  an internal edge — do not draw it.

### Per-package in-scope / out-of-scope

| Package | IN scope (owns) | OUT of scope (must not hold) |
|---|---|---|
| `shared` | pure types, DB generated types, `pricing.ts`, `ai-cost.ts`, `prompt-text.ts` | any runtime infra, any test fixture, any consumer knowledge |
| `sources` | `PortfolioSourcePort` contract, `SourceError`, capability matrix, factory, `adapters/file_upload/` and its extraction steps | engine imports (`inngest`), valuation logic, UI knowledge, naming a consumer |
| `core` | valuation and portfolio functions (ARS/USD MEP, net worth, debts) | knowing which source produced a holding; engine imports; I/O |
| `jobs` | the `JobRunner` port, the Inngest adapter, thin orchestrators that sequence steps and write job state | step logic itself (it lives in `sources`/`core`); UI knowledge |
| `apps/web` | Next app, the composition root, `/api/inngest`, the chat route handler, the assistant's read-only tools | domain logic that belongs in `core`; branching on a concrete source or engine |
| `evals` | extraction and assistant evals | being imported by anything |
| `security-tests` | pentest specs against local PostgREST, their Auth fixtures | being imported by anything |

### The live hexagons

- **`PortfolioSourcePort` (`packages/sources`).** Consumers talk to the port only. The port knows
  NOTHING — the contract imports only its sibling contract types (zod schemas, `SourceError`, the
  capability matrix) and never an adapter. The adapter knows its own implementation only. **Only the
  factory names a concrete source.** Behaviour that differs between sources is expressed through the
  capability matrix the port declares: a consumer reads `capabilities.<x>`, it never checks which
  source it holds. Errors cross the boundary as `SourceError` with `retryable`; an adapter-specific
  error class or message parsed by a consumer is a leak.
- **`JobRunner` (`packages/jobs`).** Callers say `startImport` / `cancelImport` and read the `imports`
  row; they never import `inngest`, send an Inngest event by name, or know a step id. Steps take plain
  inputs and return plain outputs; anything engine-shaped (`step.run`, retries, event payloads) stays
  in the orchestrator. Swapping the engine must touch `packages/jobs` and the composition root only.

### Machine enforcement (what actually guards this)

`pnpm check:boundaries` (`scripts/check-package-boundaries.mjs`, run in CI) checks every workspace
manifest and the root `package.json` against this graph, and fails on an `inngest` dependency
outside `packages/jobs` and the composition root. It reads manifests only: source-level relative-path
climbs across package roots (`../../jobs/src`) are still checked BY HAND. A new package needs an
entry in the script's `allowed` map, or the check fails with "unknown package".

## How to attack a change with this lens

1. **Grep for the tells.** Direct concrete-adapter imports; `new`/factory calls in
   consumers; identity/provider/flavor/kind branches in shared code; `as any` / `!` on an
   injected seam; module-scope concrete instances; raw storage/SQL in tests; comments naming
   a concrete implementation.
2. **Trace every branch.** For each conditional that varies by implementation, ask: could
   the port absorb this so the consumer stops branching? If yes, it is a defect — the branch
   must move into the adapter. Only stop when no consumer branch remains that the contract
   could physically absorb.
3. **Check the dependency direction — against the concrete DAG.** The port must not depend on
   any adapter; adapters depend on the port; consumers depend on the port only. Any edge that
   points the wrong way (a shared package importing a concrete implementation, a contract
   importing a variant, a package importing one ABOVE or SIDEWAYS of it in the repo DAG) is a
   violation. Cross-check the "Repo hierarchy" table: does the new import respect the allowed
   direction, does `inngest` appear only in `packages/jobs` and the composition root, and do
   steps in `sources`/`core` stay engine-free?
4. **Read the comments as code.** Flag any comment that leaks implementation vocabulary into
   a file that should be implementation-blind.
5. **Check placement against the sibling hexagon.** Locate the nearest existing ports-and-
   adapters module. Does the new contract sit in the same contract location, the adapters
   under `adapters/<provider>/`, the wiring at the composition root? Does any infra-bearing
   file sit inside a package whose declared deps are infra-free? A mismatch is a defect.
6. **Grep the core for leaked vocabulary.** Search the generic core for every concrete
   provider name and every adapter-coined word; any hit in a core identifier, file name, or
   comment is a defect. Confirm the interface is `<Domain>Port` and the naming mirrors the
   house convention rather than inventing a parallel term.

## Verdict language (use verbatim in review output)

- "Defect — adapter-specific logic in consumer code; move behind the port."
- "Defect — branches on the concrete implementation; the port must absorb this."
- "Defect — dependency constructed inline; inject the port instead."
- "Defect — reaches past the port; route through the contract."
- "Defect — comment references implementation the file must be blind to; remove/rewrite."
- "Defect — wrong placement; contract/adapter/wiring does not sit where the sibling hexagon puts it."
- "Defect — infra-bearing adapter placed in an infra-free package; move to the composition root and inject."
- "Defect — import points up/sideways in the repo DAG; a package may import only packages below it."
- "Defect — a package depends on `evals`; evals is a leaf consumer (nothing imports it)."
- "Defect — engine import (`inngest`) in a step or outside `packages/jobs` and the composition root; steps stay pure."
- "Defect — the port imports an adapter or something external; the port must know nothing."
- "Defect — consumer checks which source it holds instead of the port's capability matrix."
- "Defect — adapter-specific error crosses the boundary; surface it as `SourceError` with `retryable`."
- "Defect — new package with no entry in `allowed` in scripts/check-package-boundaries.mjs."
- "Defect — invented parallel vocabulary; mirror the house `<Domain>Port` naming."
- "Defect — concrete/provider name (or coined word) leaked into the implementation-blind core."
- "Defect — version/lineage marker in a name; rename by what it is."
- "Sanctioned exception — port-declared variant contract; justified, dies on unification."

A change is clean under this lens ONLY when zero defects remain and every exception is a
one-line-justified, port-declared variant. Nothing less passes.
