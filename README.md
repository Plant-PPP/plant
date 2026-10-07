# Plant

Todo tu patrimonio, en pesos y en dólares. Plant es una web app para inversores argentinos: subís lo que ya tenés (PDF del broker, capturas, CSV o Excel), la IA arma tu cartera, la revisás y la confirmás. Es solo lectura: nunca opera ni mueve plata.

## Arrancar

```bash
pnpm install
pnpm preflight
pnpm dev:up      # Supabase local, web en http://localhost:3000 e Inngest en http://localhost:8288
```

Necesitás Node 22 o superior, pnpm y Docker. Todo lo demás (estructura, comandos, ramas, migraciones y reglas) está en [`CLAUDE.md`](CLAUDE.md).

## Ramas

Ramas propias → PR a `staging` → deploy automático a staging. Producción va a salir con el workflow _Promote to production_ (PLA-13), que marca el commit con el tag `production-latest`.
