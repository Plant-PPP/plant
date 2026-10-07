#!/usr/bin/env bash
# The commit message is public once pushed, and pre-commit runs before it
# exists, so it gets its own check.
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
FORBIDDEN_WORDS_MESSAGE_FILE="$1" bash "$ROOT/scripts/check-forbidden-words.sh"
