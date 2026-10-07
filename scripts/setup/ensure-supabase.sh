#!/usr/bin/env bash
# Starts the local Supabase stack (Docker) unless it is already running.
set -euo pipefail

pnpm exec supabase status >/dev/null 2>&1 || pnpm exec supabase start
