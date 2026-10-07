#!/usr/bin/env bash
# pipefail: otherwise a failing `gen types` silently truncates database.types.ts
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
OUTFILE="$ROOT/packages/shared/src/db/generated/database.types.ts"
cd "$ROOT"

# The CLI is pinned in package.json: newer releases have changed `gen types`
# output, so a bump regenerates the types in the same commit.
pnpm exec supabase status >/dev/null 2>&1 || pnpm exec supabase start

mkdir -p "$(dirname "$OUTFILE")"
pnpm exec supabase gen types typescript --local --schema public > "$OUTFILE"

echo "Types written to $OUTFILE"
