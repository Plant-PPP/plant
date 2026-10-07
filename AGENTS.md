# AGENTS.md — ruteo de agentes en Plant

Complementa a `CLAUDE.md`, que tiene el setup, los paquetes, los comandos y las reglas del repo. Este archivo lleva a los agentes a las skills compartidas.

## Skills

Las skills viven en formato [Agent Skills](https://agentskills.io) en **`.agents/skills/<nombre>/SKILL.md`** (la copia canónica). Cada una tiene un symlink en `.claude/skills/<nombre>`, que Claude Code descubre solo y Cursor encuentra por su compatibilidad con `.claude/skills/`. Un runtime sin descubrimiento de skills (por ejemplo Codex) rutea desde esta tabla.

**El `description:` del frontmatter de cada skill es el disparador que manda: leelo ahí.** Esta tabla lista solo nombres y rutas, así no se desactualiza.

| Skill | Ruta |
|---|---|
| adv-planning | `.agents/skills/adv-planning/SKILL.md` |
| adv-research | `.agents/skills/adv-research/SKILL.md` |
| adv-review | `.agents/skills/adv-review/SKILL.md` |
| auto-build | `.agents/skills/auto-build/SKILL.md` |
| auto-implement | `.agents/skills/auto-implement/SKILL.md` |
| auto-ship-gate | `.agents/skills/auto-ship-gate/SKILL.md` |
| enforce-clean-code | `.agents/skills/enforce-clean-code/SKILL.md` |
| enforce-comment-value | `.agents/skills/enforce-comment-value/SKILL.md` |
| enforce-owner-isolation | `.agents/skills/enforce-owner-isolation/SKILL.md` |
| enforce-ports-and-adapters | `.agents/skills/enforce-ports-and-adapters/SKILL.md` |
| nav-github | `.agents/skills/nav-github/SKILL.md` |
| nav-linear | `.agents/skills/nav-linear/SKILL.md` |
| supabase-postgres-best-practices | `.agents/skills/supabase-postgres-best-practices/SKILL.md` |
| tighten | `.agents/skills/tighten/SKILL.md` |

`.agents/skills/README.md` explica cómo encajan, y `.agents/skills/_shared/runtime/capabilities.md` cómo se reparte el trabajo en olas con o sin sub-agentes.

Para sumar una skill: creá `.agents/skills/<nombre>/SKILL.md`, el symlink `ln -s ../../.agents/skills/<nombre> .claude/skills/<nombre>` y la fila en esta tabla.

## Frontmatter

El núcleo portable es `name` + `description`. Las demás claves son pistas para Claude Code, y `disable-model-invocation` es una clave de **seguridad** de Claude Code. El contrato completo está en `.agents/skills/_shared/runtime/capabilities.md`.

## Reglas para Cursor

`.cursor/rules/` repite para Cursor las reglas de `CLAUDE.md` que aplican siempre (commits, migraciones, Linear, Next.js).
