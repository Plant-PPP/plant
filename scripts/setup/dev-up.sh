#!/usr/bin/env bash
# Local stack: Supabase (Docker), the web app on :3000 and the Inngest dev
# server on :8288, which registers the functions served at /api/inngest. Both
# bind 127.0.0.1: in dev mode Inngest checks no signature. Each line carries
# its time, so the hourly quotes runs can be told apart.
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

bash ./scripts/setup/ensure-supabase.sh
bash ./scripts/setup/env-local.sh

exec pnpm exec concurrently --kill-others-on-fail --names web,inngest --prefix-colors cyan,magenta \
  --prefix "[{name} {time}]" --timestamp-format "yyyy-MM-dd HH:mm:ss" \
  "pnpm --filter @plant/web dev" \
  "pnpm exec inngest-cli dev --no-discovery --host 127.0.0.1 -u http://127.0.0.1:3000/api/inngest"
