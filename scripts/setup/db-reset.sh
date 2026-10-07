#!/usr/bin/env bash
# Rebuilds the LOCAL database from supabase/migrations. Never touches a hosted
# project: there is no --linked here, and nobody runs `supabase db push` by hand.
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

bash ./scripts/setup/ensure-supabase.sh
pnpm exec supabase db reset --local
