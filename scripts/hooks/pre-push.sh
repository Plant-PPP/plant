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
  # --porcelain also sees a first-time (untracked) types file and staged-only
  # changes, which `git diff --quiet` misses.
  if [ -n "$(git status --porcelain -- packages/shared/src/db/generated/)" ]; then
    echo "Error: the Supabase types were out of date and are now regenerated in packages/shared/src/db/generated/. Commit them and push again."
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
