#!/usr/bin/env bash
# The commit message is public once pushed, and pre-commit runs before it
# exists, so it gets its own check. It checks what an editor commit stores:
# the text above the `commit -v` scissors line, without comment lines. The
# scissors line is matched by its fixed suffix, because its leading comment
# string can come from core.commentChar=auto or core.commentString. A
# comment-looking line kept by `git commit -m` is caught by pre-push and CI,
# which read the stored message.
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
scissors=" ------------------------ >8 ------------------------"

message=$(mktemp)
trap 'rm -f "$message"' EXIT
awk -v cut="$scissors" '
  length($0) > length(cut) && substr($0, length($0) - length(cut) + 1) == cut { exit }
  { print }' "$1" \
  | git stripspace --strip-comments > "$message"

FORBIDDEN_WORDS_MESSAGE_FILE="$message" bash "$ROOT/scripts/check-forbidden-words.sh"
