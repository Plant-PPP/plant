#!/usr/bin/env bash
# Checks the migrations added since <base>: the file name, a version after the
# latest one in <base> and not in the future, and squawk (.squawk.toml).
#
#   bash scripts/check-migrations.sh <base>
#
# Runs git in the current directory and finds squawk and its config next to
# this script, so it can check any checkout.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SQUAWK="$ROOT/node_modules/.bin/squawk"
CONFIG="$ROOT/.squawk.toml"

# The CLI applies migrations in filename byte order, which matches numeric
# order only while every version has 14 digits. The name is limited to
# characters squawk will not read as a glob: it takes each path as a pattern
# and silently skips one that matches nothing.
NAME_RE='^supabase/migrations/[0-9]{14}_[A-Za-z0-9_-]+\.sql$'

base="${1:-}"
# cat-file also rejects an empty base and the all-zero SHA of a new branch.
if ! git cat-file -e "$base^{commit}" 2>/dev/null; then
  echo "::warning::No usable base ('$base'), skipping the migration checks."
  exit 0
fi

errors=0

# Unquoted paths, so names with accents reach the name check as typed.
added="$(git -c core.quotePath=false diff --name-only --no-renames --diff-filter=A "$base...HEAD" -- 'supabase/migrations/*.sql')"
if [ -z "$added" ]; then
  echo "No new migrations since $base."
  exit 0
fi

misnamed="$(printf '%s\n' "$added" | grep -Ev "$NAME_RE" || true)"
if [ -n "$misnamed" ]; then
  echo "::error::Migrations are named <14-digit timestamp>_<name>.sql, with only letters, digits, _ and - in the name (pnpm exec supabase migration new <name>):"
  echo "$misnamed"
  errors=$((errors + 1))
fi

named="$(printf '%s\n' "$added" | grep -E "$NAME_RE" || true)"
versions_where() {
  printf '%s\n' "$named" | awk -F/ -v limit="$2" -v op="$1" \
    'NF { v = substr($3, 1, 14) + 0; if ((op == "<=" && v <= limit + 0) || (op == ">" && v > limit + 0)) print }'
}

# A merged name the check above would reject still counts here; only its
# 14-digit prefix matters.
latest="$(git -c core.quotePath=false ls-tree --name-only "$base" -- supabase/migrations/ \
  | sed -nE 's|^supabase/migrations/([0-9]{14})_.*\.sql$|\1|p' | sort | tail -n 1)"
early="$(versions_where '<=' "${latest:-0}")"
if [ -n "$early" ]; then
  echo "::error::New migrations must have a version after the latest one in $base ($latest). Rename with a newer timestamp:"
  echo "$early"
  errors=$((errors + 1))
fi

# A future version ratchets every later migration past it. Versions are UTC
# (`supabase migration new` writes them that way); the day of slack covers one
# typed by hand in a zone ahead of UTC. GNU date first, then BSD (macOS).
max="$(date -u -d '+1 day' +%Y%m%d%H%M%S 2>/dev/null || date -u -v+1d +%Y%m%d%H%M%S 2>/dev/null || true)"
if [ -z "$max" ]; then
  echo "::error::Could not compute the latest allowed version with date."
  exit 1
fi
future="$(versions_where '>' "$max")"
if [ -n "$future" ]; then
  echo "::error::New migrations must not be dated in the future. Rename with the current UTC time (git mv <file> supabase/migrations/\$(date -u +%Y%m%d%H%M%S)_<name>.sql):"
  echo "$future"
  errors=$((errors + 1))
fi

if [ ! -x "$SQUAWK" ]; then
  echo "::error::squawk not found at $SQUAWK (run pnpm install)."
  exit 1
fi
# bash 3.2 (macOS) has no mapfile, and with `set -u` it fails on an empty array.
files=()
while IFS= read -r file; do
  [ -n "$file" ] && files+=("$file")
done <<EOF
$named
EOF
if [ "${#files[@]}" -gt 0 ] && ! "$SQUAWK" -c "$CONFIG" "${files[@]}"; then
  echo "::error::squawk rejected a new migration: fix the rules it lists above. Most migrations start with the header in scripts/fixtures/squawk/pass-migration-header.sql."
  errors=$((errors + 1))
fi

[ "$errors" -eq 0 ]
