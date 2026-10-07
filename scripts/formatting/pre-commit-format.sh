#!/usr/bin/env bash
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)

# --git-path also resolves inside a worktree, where .git is a file.
if [ -f "$(git rev-parse --git-path MERGE_HEAD)" ]; then
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

# Formatting restages whole files, which would sweep unstaged edits into the
# commit. Partly staged files are left alone; the CI format check still
# covers them.
fully_staged=()
for file in "${CHANGED_FILES[@]}"; do
  if git diff --quiet -- "$file"; then
    fully_staged+=("$file")
  else
    echo "[formatting] Skipped $file: it has unstaged changes."
  fi
done
CHANGED_FILES=("${fully_staged[@]}")

formatting_write_changed_files "$CHECKED_FILES" "$MISMATCHED_FILES"
