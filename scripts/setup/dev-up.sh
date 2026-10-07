#!/usr/bin/env bash
# Local stack: Supabase (Docker), the web app on :3000 and the Inngest dev
# server on :8288, which registers the functions served at /api/inngest.
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

pnpm exec supabase status >/dev/null 2>&1 || pnpm exec supabase start
bash ./scripts/setup/env-local.sh

exec pnpm exec concurrently --kill-others-on-fail --names web,inngest --prefix-colors cyan,magenta \
  "pnpm --filter @plant/web dev" \
  "pnpm exec inngest-cli dev --no-discovery -u http://localhost:3000/api/inngest"
