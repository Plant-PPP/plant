#!/usr/bin/env bash
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
OUTFILE="$ROOT/packages/shared/src/db/generated/database.types.ts"
cd "$ROOT"

# The CLI is pinned in package.json: newer releases have changed `gen types`
# output, so a bump regenerates the types in the same commit.
bash ./scripts/setup/ensure-supabase.sh

# Write to a temp file and move it into place only on success, so a failing
# `gen types` never leaves a truncated database.types.ts behind.
mkdir -p "$(dirname "$OUTFILE")"
pnpm exec supabase gen types typescript --local --schema public > "$OUTFILE.tmp" || {
  rm -f "$OUTFILE.tmp"
  exit 1
}
mv "$OUTFILE.tmp" "$OUTFILE"

echo "Types written to $OUTFILE"
