# Decisiones

Registro de decisiones que no están en el plan, o que lo bajan a detalle. La más nueva arriba.

## 07/10/2026 · Monorepo (PLA-7)

- **Los paquetes exportan TypeScript, sin build.** `@plant/shared`, `sources`, `core` y `jobs` apuntan `exports` a `src/index.ts` y `apps/web` los compila con `transpilePackages`. Así no hay un `dist` que se quede viejo ni un paso de build antes de `pnpm dev:up`. Si algún día un paquete corre fuera de Next (por ejemplo un worker de Temporal), ese paquete suma su build.
- **La CLI de Supabase va fijada en `package.json`** (`supabase` como devDependency exacta) y se usa con `pnpm exec supabase`. Una sola fuente de versión para local, hooks y CI.
- **Inngest local con `inngest-cli` fijado en `package.json`.** `pnpm dev:up` corre el dev server con `--no-discovery` apuntando a `/api/inngest`. La función `ping` (evento `plant/ping`) queda como chequeo de que el endpoint está registrado en cada entorno.
- **Variables locales en dos archivos.** `apps/web/.env.local` sale de `vercel env pull` (keys de IA) y `apps/web/.env.development.local` lo escribe `pnpm env:local` con Supabase local. Next carga el segundo encima del primero, así nunca se pisan.
- **Tests con Jest + ts-jest**, igual que la app de referencia.
- **Chequeo de palabras prohibidas sin escribir la palabra.** `scripts/check-forbidden-words.sh` lee la lista de `FORBIDDEN_WORDS` (variable de entorno en local y secreto en CI), así la palabra nunca aparece en el repo. Corre en el pre-commit y en CI.
- **`ci.yml` arranca con el job `ci`.** El job `database` (migraciones append-only, tipos al día, pgTAP y `plpgsql_check`) entra con el esquema base (PLA-16), cuando haya migraciones que chequear. El cache remoto de turbo queda para después: por ahora alcanza el cache local de Actions.
- **Skills portadas:** las que lista el plan (§2 ter), con `enforce-tenant-isolation` convertida en `enforce-owner-isolation`. Las de autonomía de noche no tienen skill propia: el modo se arma solo con un pedido explícito y se describe en `_shared/night-shift/detect.md`.
