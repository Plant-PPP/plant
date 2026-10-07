# Plant

Web app para que inversores argentinos vean todo su patrimonio en pesos y en dólares MEP: suben lo que ya tienen (PDF del broker, capturas, CSV o Excel), la IA arma la cartera, el usuario la revisa y confirma. Es **solo lectura**: nunca opera, transfiere ni custodia, y no hay botones de comprar o vender.

Las rutas de skills y el ruteo de agentes están en [`AGENTS.md`](AGENTS.md).

## Setup

Monorepo pnpm + turbo. Necesitás Node >= 22, pnpm (`corepack enable`) y Docker.

```bash
pnpm install
pnpm preflight                      # revisa lo que falta
vercel env pull apps/web/.env.local # keys de desarrollo (Gemini, Anthropic), opcional al principio
pnpm dev:up                         # Supabase local + web en :3000 + Inngest dev en :8288
```

`pnpm dev:up` levanta Supabase si no está corriendo, escribe `apps/web/.env.development.local` con las URLs y keys locales (`pnpm env:local`) y arranca la web y el dev server de Inngest, que registra las funciones de `/api/inngest`. Se corta con Ctrl-C.

## Estructura

| Paquete | Qué tiene |
|---|---|
| `apps/web` | Next.js 16 (App Router) + React 19 en Vercel `gru1`. Incluye `/api/inngest` y el chat |
| `packages/shared` | Dinero (`Money` con string decimal y moneda), `pricing.ts`, `ai-cost.ts`, `prompt-text.ts`, tipos de la base |
| `packages/sources` | `PortfolioSourcePort` y el adaptador `file_upload` |
| `packages/core` | Valuación y funciones de cartera que usan la UI y el asistente |
| `packages/jobs` | Puerto `JobRunner` y orquestadores de Inngest |
| `supabase/` | Config, migraciones y tests pgTAP |
| `evals/` | Evals de extracción y del asistente (los documentos reales viven fuera del repo) |

Los paquetes exportan sus fuentes TypeScript y `apps/web` los compila con `transpilePackages`, así que no hay que buildearlos antes de levantar la web.

## Tests y chequeos

```bash
pnpm check          # typecheck + lint de todo
pnpm test           # tests de todo
pnpm turbo:affected # solo lo que cambió contra origin/staging
pnpm format         # prettier sobre lo cambiado
```

Husky (`.husky/`, con la lógica en `scripts/hooks/`) corre prettier y el chequeo de palabras prohibidas en el pre-commit, y typecheck, lint y tests de lo afectado en el pre-push.

## Ramas, commits y PRs

- `staging` es la única rama de trabajo y está protegida. Trabajá en una rama propia con la key de Linear (`feat/pla-12-job-runner`) y abrí un PR a `staging`. Al hacer merge se despliega solo a staging.
- **Nunca hagas push a `production`.** Es una rama congelada que existe solo porque Vercel pide una Production Branch. Producción sale con el workflow *Promote to production* y queda marcada con el tag `production-latest`. No hay `main`.
- Commits y títulos de PR en Conventional Commits, menos de 70 caracteres. Migraciones destructivas: `[DESTRUCTIVE]` al principio del título.
- El cuerpo del PR arranca con `## Intent` y sigue el template de `.github/pull_request_template.md`.
- Se permiten los trailers de co-autor de Claude Code (`Co-Authored-By:`).

## Supabase

**Nunca corras `supabase db push`.** Las migraciones llegan a staging por CI en cada merge.

```bash
pnpm exec supabase migration new <nombre>
pnpm db:reset                       # rehace la base local desde las migraciones
pnpm db:generate:supabase-types     # después de cada migración; CI falla si quedan viejos
```

- Una migración aplicada en staging es de solo lectura: los cambios van en una migración nueva.
- RLS en cada tabla desde que se crea, con `user_id = (select auth.uid())` en `USING` y `WITH CHECK`.
- "Automatically expose new tables" está apagado en Supabase: cada migración hace `GRANT` explícito a `authenticated` solo con las operaciones que la app usa. Nunca a `anon`.
- `REVOKE ... FROM PUBLIC, anon, authenticated` explícito en las funciones, y `SECURITY DEFINER` siempre con `SET search_path`.
- Plata en `numeric` en Postgres y como string decimal en el contrato, nunca en float. Cada monto lleva su moneda.

## Variables de entorno

- `apps/web/.env.local` sale **solo** de `vercel env pull apps/web/.env.local`; no lo edites a mano.
- `apps/web/.env.development.local` lo escribe `pnpm env:local` con Supabase local.
- `.env.example` lista los nombres sin valores. Si sumás una variable, agregala ahí y en cada plataforma.

## Repo público

- Nunca entra un `.env`, una key, un documento real, datos personales, el plan ni los análisis internos. Los fixtures de tests son inventados.
- No se nombra la app de referencia de la que se portan patrones: ni en código, comentarios, commits, ramas, PRs, skills ni docs. Se habla de "la app de referencia" o directamente del patrón. `pnpm check:forbidden-words` lo verifica si tenés `FORBIDDEN_WORDS` en tu shell.
- Actions con `permissions: contents: read`, fijadas por SHA y nunca `pull_request_target` con checkout del PR.

## Producto

- Toda la UI va en español de Argentina con voseo. Números en formato `es-AR` (`$ 1.234.567,89`, `US$ 12.345,67`).
- El asistente explica, resume y compara. **Nunca recomienda comprar o vender** y muestra el aviso de que no es asesoramiento financiero.
- Los números de los gráficos nunca salen del modelo: el servidor carga los datos y arma el spec de Vega-Lite.
- El texto de documentos y del usuario pasa por `prompt-text.ts` y se trata como no confiable. Las tools del asistente son de solo lectura y filtran por el usuario de la sesión.
- La IA ignora DNI, CUIT y CBU. Nunca se loguean montos, tenencias, CUIT, tokens ni el JSON extraído.
- Si algo no está especificado, elegí la opción más simple y anotala en `docs/decisiones.md`.

## Comentarios y prosa de PRs

No defiendas una decisión que nadie cuestionaría. Antes de explicar por qué algo *no está*, o por qué no se tomó una alternativa, preguntate: ¿un lector competente asumiría que debería estar y abriría un bug si faltara? Si sí, explicalo. Si no, borralo: la explicación solo planta la idea que responde.

Lo mismo para cuerpos de PR y mensajes de commit, más: describí el estado actual del cambio y por qué, no cómo se llegó. Nada de narrar iteraciones ("arreglado en el segundo commit", "atendí la review") ni stats del diff: GitHub ya los muestra.
