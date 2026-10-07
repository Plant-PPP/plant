#!/usr/bin/env bash
# Rebuilds the LOCAL database from supabase/migrations. Never touches a hosted
# project: there is no --linked here, and nobody runs `supabase db push` by hand.
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

pnpm exec supabase status >/dev/null 2>&1 || pnpm exec supabase start
pnpm exec supabase db reset --local
