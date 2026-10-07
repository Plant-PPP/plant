#!/usr/bin/env bash
# Regenerates the Supabase types and exits 1 if that changed them, or 2 if they
# could not be generated.
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"
# shellcheck source=scripts/lib/supabase-types-path.sh
source ./scripts/lib/supabase-types-path.sh

bash ./scripts/generate-supabase-types.sh || {
  echo "Could not generate the Supabase types." >&2
  exit 2
}

# --porcelain also sees a first-time (untracked) types file and staged-only
# changes, which `git diff --quiet` misses.
status="$(git status --porcelain -- "$SUPABASE_TYPES_FILE")"
if [ -n "$status" ]; then
  echo "The Supabase types were out of date and are now regenerated in $SUPABASE_TYPES_FILE. Commit them."
  echo "$status"
  git --no-pager diff -- "$SUPABASE_TYPES_FILE"
  exit 1
fi
