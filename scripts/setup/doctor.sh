#!/usr/bin/env bash
# Checks the local prerequisites for `pnpm dev:up`.
set -uo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"
failed=0

ok() { printf '  ok    %s\n' "$1"; }
bad() { printf '  FAIL  %s\n        %s\n' "$1" "$2"; failed=1; }

node_major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
if [ "$node_major" -ge 22 ]; then ok "Node $(node -v)"; else bad "Node >= 22" "Install Node 22 or newer."; fi

if command -v pnpm >/dev/null 2>&1; then ok "pnpm $(pnpm -v)"; else bad "pnpm" "corepack enable"; fi

if docker info >/dev/null 2>&1; then ok "Docker"; else bad "Docker" "Local Supabase runs in Docker: open Docker Desktop."; fi

if [ -d node_modules ]; then ok "Dependencies installed"; else bad "Dependencies" "pnpm install"; fi

if pnpm exec supabase --version >/dev/null 2>&1; then ok "Supabase CLI $(pnpm exec supabase --version)"; else bad "Supabase CLI" "pnpm install"; fi

if [ -f apps/web/.env.development.local ]; then ok "apps/web/.env.development.local"; else printf '  warn  apps/web/.env.development.local is missing: `pnpm dev:up` writes it (or `pnpm env:local` with Supabase running)\n'; fi

if [ -f apps/web/.env.local ]; then ok "apps/web/.env.local"; else printf '  warn  apps/web/.env.local is missing: AI keys come from `vercel env pull apps/web/.env.local`\n'; fi

exit "$failed"
