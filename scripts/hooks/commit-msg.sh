#!/usr/bin/env bash
# The commit message is public once pushed, and pre-commit runs before it
# exists, so it gets its own check.
set -euo pipefail

pattern="${FORBIDDEN_WORDS:-}"
[ -z "$pattern" ] && exit 0

if grep -v '^#' "$1" | grep -qiE -- "$pattern"; then
  echo "[forbidden-words] The commit message contains a forbidden word." >&2
  exit 1
fi
