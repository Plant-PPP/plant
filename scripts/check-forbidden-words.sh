#!/usr/bin/env bash
# The repo is public. Fails if a tracked file, a file name, a staged addition,
# a commit message or the branch name contains a forbidden word. The list
# lives in FORBIDDEN_WORDS (one case-insensitive extended regex) so the word
# itself never has to be spelled out in the repo: set it in your shell profile
# and in the CI secret FORBIDDEN_WORDS. Output masks every match, because CI
# logs of a public repo are public too.
#
# Optional (CI sets all three; the pre-push hook sets the last two):
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
  echo "[forbidden-words] WARNING: FORBIDDEN_WORDS is not set, nothing was checked. Export it in your shell profile." >&2
  exit 0
fi

# grep exits 2 on a malformed regex; that must fail, not read as "clean".
status=0
printf '' | grep -iE -- "$pattern" >/dev/null || status=$?
if [ "$status" -gt 1 ]; then
  echo "[forbidden-words] FORBIDDEN_WORDS is not a valid extended regex." >&2
  exit 1
fi

# perl, not sed: macOS sed has no case-insensitive s///, and a "/" in the
# pattern would end the expression.
export FORBIDDEN_WORDS_PATTERN="$pattern"
mask() { perl -pe 's/$ENV{FORBIDDEN_WORDS_PATTERN}/***/gi'; }

die() {
  echo "[forbidden-words] $1 failed; nothing can be called clean." >&2
  exit 1
}

found=0
# $1 = label, $2 = lines that already are hits (empty = none).
flag() {
  [ -z "$2" ] && return 0
  found=1
  echo "[forbidden-words] $1:" >&2
  printf '%s\n' "$2" | mask >&2
}
# $1 = label, $2 = text to search, one item per line.
report() {
  flag "$1" "$(printf '%s\n' "$2" | grep -iE -- "$pattern" || true)"
}

# Each git command runs on its own so a failure stops the check instead of
# reading as "no match". --text everywhere: otherwise a binary file, or one a
# .gitattributes entry marks -diff, is skipped silently.
names=$(git ls-files) || die "git ls-files"
report "file names" "$names"

contents=$(git grep --text -i -l -E -e "$pattern" -- .) || {
  [ $? -eq 1 ] || die "git grep"
}
flag "files whose contents match" "$contents"

staged_names=$(git diff --cached --name-only --diff-filter=ACR) || die "git diff --cached"
report "staged file names" "$staged_names"

staged=$(git diff --cached --text -U0 --no-color) || die "git diff --cached"
report "staged additions" "$(printf '%s\n' "$staged" | grep -E '^\+' | grep -vE '^\+\+\+ ' || true)"

# Every commit in the range is public once pushed, even if a later commit
# removes what it added.
if [ -n "${FORBIDDEN_WORDS_RANGE:-}" ]; then
  range="$FORBIDDEN_WORDS_RANGE"
  messages=$(git log --format='%h %an %ae %cn %ce %B' "$range") || die "git log $range"
  report "commit messages and authors in $range" "$messages"

  touching=$(git log --text --regexp-ignore-case -G "$pattern" --format='%h' "$range") \
    || die "git log -G $range"
  flag "commits whose diff adds or removes it in $range" "$touching"

  touched_names=$(git log --name-only --format= "$range") || die "git log --name-only $range"
  report "file names in the commits of $range" "$(printf '%s\n' "$touched_names" | sort -u)"
fi
if [ -n "${FORBIDDEN_WORDS_BRANCH:-}" ]; then
  report "branch name" "$FORBIDDEN_WORDS_BRANCH"
fi

if [ "$found" -eq 1 ]; then
  echo "[forbidden-words] Remove the forbidden word from the places above." >&2
  exit 1
fi
echo "[forbidden-words] Clean."
