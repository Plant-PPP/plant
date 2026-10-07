#!/usr/bin/env bash
# Checks the local prerequisites for `pnpm dev:up`.
set -uo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"
failed=0

ok() { printf '  ok    %s\n' "$1"; }
bad() { printf '  FALTA %s\n        %s\n' "$1" "$2"; failed=1; }

node_major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
if [ "$node_major" -ge 22 ]; then ok "Node $(node -v)"; else bad "Node >= 22" "Instalá Node 22 o superior."; fi

if command -v pnpm >/dev/null 2>&1; then ok "pnpm $(pnpm -v)"; else bad "pnpm" "corepack enable"; fi

if docker info >/dev/null 2>&1; then ok "Docker"; else bad "Docker" "Supabase local corre en Docker: abrí Docker Desktop."; fi

if [ -d node_modules ]; then ok "Dependencias instaladas"; else bad "Dependencias" "pnpm install"; fi

if pnpm exec supabase --version >/dev/null 2>&1; then ok "Supabase CLI $(pnpm exec supabase --version)"; else bad "Supabase CLI" "pnpm install"; fi

if [ -f apps/web/.env.development.local ]; then ok "apps/web/.env.development.local"; else printf '  aviso apps/web/.env.development.local no existe: lo escribe `pnpm dev:up` (o `pnpm env:local` con Supabase corriendo)\n'; fi

if [ -f apps/web/.env.local ]; then ok "apps/web/.env.local"; else printf '  aviso apps/web/.env.local no existe: las keys de IA salen de `vercel env pull apps/web/.env.local`\n'; fi

exit "$failed"
