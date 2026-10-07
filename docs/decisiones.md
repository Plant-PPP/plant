# Decisiones

Registro de decisiones que no están en el plan, o que lo bajan a detalle. La más nueva arriba.

## 07/10/2026 · Monorepo (PLA-7)

- **Los paquetes exportan TypeScript, sin build.** `@plant/shared`, `sources`, `core` y `jobs` apuntan `exports` a `src/index.ts` y `apps/web` los compila con `transpilePackages`. Así no hay un `dist` que se quede viejo ni un paso de build antes de `pnpm dev:up`. Si algún día un paquete corre fuera de Next (por ejemplo un worker de Temporal), ese paquete suma su build.
- **La CLI de Supabase va fijada en `package.json`** (`supabase` como devDependency exacta) y se usa con `pnpm exec supabase`. Una sola fuente de versión para local, hooks y CI.
- **Inngest local con `inngest-cli` fijado en `package.json`.** `pnpm dev:up` corre el dev server con `--no-discovery` apuntando a `/api/inngest`. La función `ping` (evento `plant/ping`) queda como chequeo de que el endpoint está registrado en cada entorno.
- **Variables locales en dos archivos.** `apps/web/.env.local` sale de `vercel env pull` (keys de IA) y `apps/web/.env.development.local` lo escribe `pnpm env:local` con Supabase local. Next carga el segundo encima del primero, así nunca se pisan.
- **Tests con Jest + ts-jest**, igual que la app de referencia.
- **Chequeo de palabras prohibidas sin escribir la palabra.** `scripts/check-forbidden-words.sh` lee la lista de `FORBIDDEN_WORDS` (variable de entorno en local y secreto en CI), así la palabra nunca aparece en el repo. Dónde corre, más abajo.
- **`ci.yml` arranca con el job `ci`.** El job `database` (migraciones append-only, tipos al día, pgTAP y `plpgsql_check`) entra con el esquema base (PLA-16), cuando haya migraciones que chequear. El cache remoto de turbo queda para después: por ahora alcanza el cache local de Actions.
- **El modo de Inngest sale de `NODE_ENV`, no de `INNGEST_DEV`.** El cliente fija `isDev` solo en `next dev`. En modo dev Inngest no verifica la firma de los requests, así que una variable suelta en Vercel no puede abrir `/api/inngest` en producción.
- **Turbo con un nodo `transit`.** `typecheck`, `lint` y `test` dependen de `transit`, que solo propaga `^transit`: el cache se invalida cuando cambia la fuente de un paquete del que dependés, sin hacer esperar a las tareas entre sí. `check` = `typecheck` + `lint`.
- **Las devDependencies compartidas van en el `catalog`** de `pnpm-workspace.yaml` (TypeScript, Jest, ESLint, tipos), para no tener versiones distintas por paquete. Los paquetes comparten `eslint.packages.mjs`.
- **Límites entre paquetes en un script** (`scripts/check-package-boundaries.mjs`, corre en CI) sobre las dependencias que declara cada `package.json` del workspace: `shared` no depende de nadie, `sources` y `core` solo de `shared`, `jobs` de los tres y solo `jobs` y `web` declaran `inngest`.
- **`auto_expose_new_tables = false`** en `supabase/config.toml`, igual que en los proyectos hosteados: cada tabla necesita su `GRANT`.
- **`pnpm audit` cubre también las devDependencies**, porque corren en CI y en la máquina de cada uno. Los fixes que todavía no llegaron por el paquete padre van como `overrides`, y una alerta sin versión arreglada va en `auditConfig.ignoreGhsas` con el motivo.
- **Dependabot espera 7 días** antes de proponer una versión nueva (`cooldown`). El mismo límite en pnpm (`minimumReleaseAge`) queda para cuando las dependencias actuales tengan más de una semana; hoy obligaría a bajar Next y turbo.
- **El chequeo de palabras prohibidas falla cerrado en CI**: sin el secreto falla en push y en PRs del mismo repo (solo saltea forks y Dependabot), y revisa también cada commit del PR (diff, nombres de archivo, mensaje y autor) y el nombre de la rama. Corre antes que cualquier otro script de la rama, y `forbidden-words.yml` lo repite en cada push a cualquier otra rama, tenga PR o no. Los logs nunca muestran el texto que coincide: solo cuántas coincidencias hay, ids de commit y rutas. Protege contra filtrar la palabra por accidente, no contra alguien con permiso de push, que puede leer el secreto editando el workflow. Localmente lo repiten el hook `commit-msg` y el pre-push, sobre cada rama que se sube.
- **`/api/inngest` no acepta syncs sin firma** (`enableUnauthedSync: false`). Threat model en `docs/threat-models/2026-10-07-endpoint-inngest.md`.
- **Headers de seguridad base** en `next.config.ts` (sin iframes, `nosniff`, `Referrer-Policy`). La CSP con nonce llega con el login (PLA-17).
- **La deny list de `.claude/settings.json` es una ayuda, no la frontera.** Lo que de verdad protege `staging` y `production` es el ruleset de GitHub (PR obligatorio, CI en verde, sin force push ni borrado).
- **Sin telemetría todavía.** OpenTelemetry con Dash0 y los eventos de PostHog entran con PLA-21; hasta entonces `/api/inngest` y la home no emiten nada.
- **Skills portadas:** las que lista el plan (§2 ter), con `enforce-tenant-isolation` convertida en `enforce-owner-isolation`. Las de autonomía de noche no tienen skill propia: el modo se arma solo con un pedido explícito y se describe en `_shared/night-shift/detect.md`.
