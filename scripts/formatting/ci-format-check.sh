#!/usr/bin/env bash
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
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

changed_against_staging --pattern "$FORMAT_FILE_PATTERN" "${FORMAT_PROJECTS[@]}"
echo
formatting_check_changed_files "$CHECKED_FILES" "$MISMATCHED_FILES"
