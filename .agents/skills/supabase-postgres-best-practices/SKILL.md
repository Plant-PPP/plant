---
name: supabase-postgres-best-practices
description: Postgres performance optimization and best practices from Supabase. Use this skill when writing, reviewing, or optimizing Postgres queries, schema designs, or database configurations.
license: MIT
metadata:
  author: supabase
  version: "1.1.0"
  organization: Supabase
  date: January 2026
  abstract: Comprehensive Postgres performance optimization guide for developers using Supabase and Postgres. Contains performance rules across 8 categories, prioritized by impact from critical (query performance, connection management) to incremental (advanced features). Each rule includes detailed explanations, incorrect vs. correct SQL examples, query plan analysis, and specific performance metrics to guide automated optimization and code generation.
---

# Supabase Postgres Best Practices

Comprehensive performance optimization guide for Postgres, maintained by Supabase. Contains rules across 8 categories, prioritized by impact to guide automated query optimization and schema design.

## When to Apply

Reference these guidelines when:
- Writing SQL queries or designing schemas
- Implementing indexes or query optimization
- Reviewing database performance issues
- Configuring connection pooling or scaling
- Optimizing for Postgres-specific features
- Working with Row-Level Security (RLS)

## Rule Categories by Priority

| Priority | Category | Impact | Prefix |
|----------|----------|--------|--------|
| 1 | Query Performance | CRITICAL | `query-` |
| 2 | Connection Management | CRITICAL | `conn-` |
| 3 | Security & RLS | CRITICAL | `security-` |
| 4 | Schema Design | HIGH | `schema-` |
| 5 | Concurrency & Locking | MEDIUM-HIGH | `lock-` |
| 6 | Data Access Patterns | MEDIUM | `data-` |
| 7 | Monitoring & Diagnostics | LOW-MEDIUM | `monitor-` |
| 8 | Advanced Features | LOW | `advanced-` |

## How to Use

Read individual rule files for detailed explanations and SQL examples:

```
references/query-missing-indexes.md
references/query-partial-indexes.md
references/security-rls-basics.md
```

`AGENTS.md` lists every reference file by category.

Each rule file contains:
- Brief explanation of why it matters
- Incorrect SQL example with explanation
- Correct SQL example with explanation
- Optional EXPLAIN output or metrics
- Additional context and references
- Supabase-specific notes (when applicable)

## Plant conventions (override the generic examples)

The reference files are upstream Supabase guidance with generic examples. Where they differ, Plant's
conventions win:

- **Single-user ownership, no organizations or teams.** Every owned table has `user_id uuid not null
  references auth.users`, and its policy pins `user_id = (select auth.uid())` in BOTH `using` and
  `with check`, `to authenticated`. Index `user_id`. Every `public` table also gets the RESTRICTIVE
  MFA gate, copied from the house form in `.agents/skills/enforce-owner-isolation/SKILL.md` (the
  pgTAP floor compares its text).
- **Grants are explicit.** `authenticated` gets only the operations the app uses; `anon` gets
  nothing. Functions get `revoke all ... from public, anon, authenticated` before any targeted grant
  (on Supabase, `from public` alone leaves the default per-role grants standing).
- **`security definer` always carries `set search_path`** (prefer `''` with qualified names), and
  policy helpers live in schema `private`, which the API does not expose.
- **Money is `numeric`, never float**, with no narrow fixed precision (ARS amounts grow large), and
  every amount sits next to its currency column.
- **Service role is server-only** (background jobs), and those queries filter by `user_id`
  explicitly because RLS does not apply to them.
- Migrations live in `supabase/migrations/`; RLS and grant regressions are tested with pgTAP in
  `supabase/tests/`.

The adversarial review of policies, grants, and definer functions is `enforce-owner-isolation`;
this skill is the machinery it builds on.

## References

- https://www.postgresql.org/docs/current/
- https://supabase.com/docs
- https://wiki.postgresql.org/wiki/Performance_Optimization
- https://supabase.com/docs/guides/database/overview
- https://supabase.com/docs/guides/auth/row-level-security
