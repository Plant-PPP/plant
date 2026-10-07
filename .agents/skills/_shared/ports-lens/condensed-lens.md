# Condensed ports-and-adapters lens (paste verbatim per subagent)

This is the block review/planning/implementation skills paste into EVERY subagent prompt (a
"see the ports skill" reference is inert — subagents inherit nothing but their prompt). The fat
`enforce-ports-and-adapters/SKILL.md` (package tables, the live hexagons —
PortfolioSourcePort and JobRunner — machine-enforcement, verdict encyclopedia) is the ORCHESTRATOR's step-1 Read; subagents get only the block below.

```
=== PORTS-AND-ADAPTERS LENS (attack every change for boundary violations) ===
On its own `ports-lens loaded:`-prefixed line in the load-proof header block (header order: catalog, ports-lens, dry-lens; the tripwire keys on the PREFIX, not on being line 1), or this wave is NON-CLEAN and re-run:
  ports-lens loaded: adapter-specific logic stays behind the port | touched packages: <list | "none — no port surface in diff">
("none" is a CLEAN pass. The tripwire fires ONLY on a missing or garbled ports-lens line — it never
forces a package or a rank on a diff that has no port surface.)

THE FOUR CO-EQUAL LAWS — check and REPORT each (an unstated law is UNCHECKED, not passed):
1. NO-BRANCH — nothing outside an adapter branches on the concrete impl. `provider==="…"`,
   `source.kind === "file_upload"`, a variant ternary/switch in shared or consumer code = defect. The
   port absorbs the difference (in sources: via the capability matrix it declares, and errors as
   SourceError with `retryable`); consumers see one uniform contract.
2. PLACEMENT — the port lives in the contract layer; each adapter lives wholly under
   adapters/<provider>/; concretes are wired only at the composition root. Correct code in the
   wrong file is a defect. An infra-bearing adapter inside a deliberately infra-free package is
   a defect — move it to the root and inject via a driven port.
3. DAG-DIRECTION — every first-party import (runtime OR dev) points STRICTLY downward:
     leaf:      shared (@plant/shared)   (imports no internal package; infra-free — no Supabase/HTTP/
                Inngest/AI-SDK runtime dep)
     domain:    sources → shared; core → shared   (sources and core are mutually blind peers)
     orchestr.: jobs → { sources, core, shared }
     app:       apps/web → { jobs, core, sources, shared }   (the composition root — the only place
                that wires concretes; hosts /api/inngest and the chat route)
     off-spine: evals → may import packages; NOTHING imports evals
   An edge pointing up or sideways = defect. Engine rule: steps are pure functions in sources/core with
   NO engine import — `inngest` appears only in packages/jobs and the composition root. `pnpm
   check:boundaries` enforces the manifest graph (root included); relative-path climbs across package
   roots are checked BY HAND, and a new package without an entry in the script's `allowed` map fails.
4. CONTRACT-VOCAB — the core speaks only the contract's words. A provider/adapter name or coined
   word (inngest, file_upload, an AI provider, a broker) leaked into a core identifier, file, shared
   type, or comment = boundary leak (HARD blocker). New ports are named `<Domain>Port` like
   PortfolioSourcePort (JobRunner keeps its established name). A version/lineage marker (v2/old/legacy/base/generic) or invented parallel term where
   a house term exists = defect, downgradable to a tracked follow-up ONLY if pre-existing and
   purely cosmetic (state the downgrade; don't default to it).

SEVERITY: no-branch / placement / DAG / provider-leak = HARD blockers (any one = does not merge).
Lineage-marker / parallel-vocab nit = raise-and-downgradable. All four are co-equal in must-check;
they are severity-tiered only for what blocks a merge.

ONLY sanctioned exception: a variance the PORT ITSELF declares. Justify in one line naming BOTH
(1) the port field declaring the variance and (2) the death condition (deleted when the contract
unifies). Missing either = defect. Branching just to make an assertion "pass for both" = FORBIDDEN.

FIX every violation in this change. The only deferrable is one literally unexpressible today
(the seam does not yet exist) — RAISE it and file a follow-up, never tolerate it silently.

PER-LAW VERDICT: if the change touches a port surface (any cross-package import, any file under a
contract/ or adapters/<provider>/ dir, any shared/consumer code that could branch), emit
PASS|DEFECT + one line for all four laws. If it touches NO port surface, emit exactly:
  ports: N/A — no port surface (no cross-package import, no adapter/contract/shared change).
=== END PORTS LENS ===
```
