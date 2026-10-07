#!/usr/bin/env bash
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"
# shellcheck source=scripts/lib/supabase-types-path.sh
source ./scripts/lib/supabase-types-path.sh
OUTFILE="$ROOT/$SUPABASE_TYPES_FILE"

bash ./scripts/setup/ensure-supabase.sh

# Write to a temp file next to the target and rename it only on success, so a
# failed or interrupted run never leaves a truncated database.types.ts behind. The CLI is pinned in package.json: newer releases
# have changed `gen types` output, so a bump regenerates the types in the same
# commit.
mkdir -p "$(dirname "$OUTFILE")"
tmp=$(mktemp "$OUTFILE.XXXXXX")
trap 'rm -f "$tmp"' EXIT
pnpm exec supabase gen types typescript --local --schema public > "$tmp"
mv "$tmp" "$OUTFILE"

echo "Types written to $OUTFILE"
