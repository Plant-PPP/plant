#!/usr/bin/env bash
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)

"$ROOT/scripts/formatting/pre-commit-format.sh"
"$ROOT/scripts/check-forbidden-words.sh"

# Optional extra net before the push protection on GitHub.
if command -v gitleaks >/dev/null 2>&1; then
  gitleaks git --staged --redact --no-banner
fi
