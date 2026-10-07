#!/usr/bin/env bash
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)

if git show-ref --verify --quiet refs/remotes/origin/staging; then
  merge_base="$(git merge-base HEAD origin/staging)"
else
  merge_base=""
fi

# Regenerate the Supabase types only when the branch adds migrations.
if [ -n "$merge_base" ] && git diff --diff-filter=A --name-only "$merge_base"...HEAD -- "supabase/migrations/*.sql" | grep -q .; then
  pnpm run db:generate:supabase-types
  if ! git diff --quiet packages/shared/src/db/generated/; then
    echo "Error: Supabase types are out of date. Run 'pnpm db:generate:supabase-types' and commit the changes."
    git checkout -- packages/shared/src/db/generated/
    exit 1
  fi
fi

# Typecheck, lint and test the packages this branch affects, per the
# dependency graph. Without origin/staging (fresh clone) there is no base to
# diff against, so fall back to the whole repo.
export TURBO_TELEMETRY_DISABLED=1
if [ -n "$merge_base" ]; then
  export TURBO_SCM_BASE=origin/staging
  affected=--affected
else
  affected=
fi

pnpm exec turbo run check test $affected
