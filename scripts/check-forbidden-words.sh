#!/usr/bin/env bash
# The repo is public. Fails if a tracked or staged file, or a file name,
# contains a forbidden word. The list lives in FORBIDDEN_WORDS (one
# case-insensitive extended regex) so the word itself never has to be spelled
# out in the repo: set it in your shell profile and in the CI secret
# FORBIDDEN_WORDS.
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

pattern="${FORBIDDEN_WORDS:-}"
if [ -z "$pattern" ]; then
  echo "[forbidden-words] FORBIDDEN_WORDS is not set; skipping."
  exit 0
fi

found=0
if git ls-files | grep -iE "$pattern"; then found=1; fi
if git grep -I -i -l -E "$pattern" -- . ; then found=1; fi
if git diff --cached -U0 | grep -iE "$pattern" >/dev/null; then
  echo "(staged changes)"
  found=1
fi

if [ "$found" -eq 1 ]; then
  echo "[forbidden-words] Remove the forbidden word from the files above." >&2
  exit 1
fi
echo "[forbidden-words] Clean."
