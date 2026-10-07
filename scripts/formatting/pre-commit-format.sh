#!/usr/bin/env bash
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)

if [ -f "$ROOT/.git/MERGE_HEAD" ]; then
  echo "[formatting] Skipped during merge commit."
  exit 0
fi

CHECKED_FILES=$(mktemp)
MISMATCHED_FILES=$(mktemp)

cleanup() {
  rm -f "$CHECKED_FILES" "$MISMATCHED_FILES"
}

trap cleanup EXIT

source "$ROOT/scripts/formatting/constants.sh"
source "$ROOT/scripts/formatting/changed-files.sh"
source "$ROOT/scripts/formatting/formatting.sh"

cd "$ROOT"

changed_staged --pattern "$FORMAT_FILE_PATTERN" "${FORMAT_PROJECTS[@]}"
formatting_write_changed_files "$CHECKED_FILES" "$MISMATCHED_FILES"
