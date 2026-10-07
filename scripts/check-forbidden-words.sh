#!/usr/bin/env bash
# The repo is public. Fails if a tracked file, a file name, a staged addition,
# a commit message or the branch name contains a forbidden word. The list
# lives in FORBIDDEN_WORDS (one case-insensitive extended regex) so the word
# itself never has to be spelled out in the repo: set it in your shell profile
# and in the CI secret FORBIDDEN_WORDS. Output masks every match, because CI
# logs of a public repo are public too.
#
# Optional:
#   REQUIRE_FORBIDDEN_WORDS=1     fail instead of skipping when the list is unset
#   FORBIDDEN_WORDS_RANGE=A..B    also check the commit messages in that range
#   FORBIDDEN_WORDS_BRANCH=name   also check that branch name
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

pattern="${FORBIDDEN_WORDS:-}"
if [ -z "$pattern" ]; then
  if [ -n "${REQUIRE_FORBIDDEN_WORDS:-}" ]; then
    echo "[forbidden-words] FORBIDDEN_WORDS is not set and this run requires it." >&2
    exit 1
  fi
  echo "[forbidden-words] FORBIDDEN_WORDS is not set; skipping."
  exit 0
fi

# grep exits 2 on a malformed regex; that must fail, not read as "clean".
status=0
printf '' | grep -iE -- "$pattern" >/dev/null || status=$?
if [ "$status" -gt 1 ]; then
  echo "[forbidden-words] FORBIDDEN_WORDS is not a valid extended regex." >&2
  exit 1
fi

mask() { sed -E "s/$pattern/***/Ig"; }

found=0
report() {
  # $1 = label; stdin = matching lines.
  local hits
  hits=$(cat)
  [ -z "$hits" ] && return 0
  found=1
  echo "[forbidden-words] $1:" >&2
  printf '%s\n' "$hits" | mask >&2
}

# report runs in this shell (not in a pipeline) so it can set found.
report "file names" < <(git ls-files | grep -iE -- "$pattern" || true)
report "file contents" < <(git grep -I -i -l -E -e "$pattern" -- . || true)
report "staged file names" < <(
  git diff --cached --name-only --diff-filter=ACR | grep -iE -- "$pattern" || true
)
report "staged additions" < <(
  git diff --cached -U0 --no-color | grep -E '^\+' | grep -vE '^\+\+\+ ' \
    | grep -iE -- "$pattern" || true
)
if [ -n "${FORBIDDEN_WORDS_RANGE:-}" ]; then
  report "commit messages in $FORBIDDEN_WORDS_RANGE" < <(
    git log --format='%h %B' "$FORBIDDEN_WORDS_RANGE" | grep -iE -- "$pattern" || true
  )
fi
if [ -n "${FORBIDDEN_WORDS_BRANCH:-}" ]; then
  report "branch name" < <(
    printf '%s\n' "$FORBIDDEN_WORDS_BRANCH" | grep -iE -- "$pattern" || true
  )
fi

if [ "$found" -eq 1 ]; then
  echo "[forbidden-words] Remove the forbidden word from the places above." >&2
  exit 1
fi
echo "[forbidden-words] Clean."
