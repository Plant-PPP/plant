# Threat model: endpoint `/api/inngest`

Rama `claude/project-thread-7gbyoe` (PLA-7). Lo pide el disparador "Endpoint nuevo o cambio de frontera de confianza": `/api/inngest` queda expuesto a internet en cada deploy de Vercel.

## Alcance y activos

Hoy el endpoint sirve una sola función, `ping`, que no lee ni escribe datos. Lo que protege es la capacidad de ejecutar funciones de Plant y de registrar la app en Inngest. Cuando lleguen las importaciones (Carga con IA), esas funciones van a usar service role, así que este endpoint pasa a ser la puerta a los documentos y tenencias de cada usuario.

## Frontera de confianza

Cualquiera en internet puede mandar GET, POST o PUT a `/api/inngest` (HEAD va al GET; OPTIONS lo responde Next sin tocar Inngest). Solo Inngest, que firma cada request con `INNGEST_SIGNING_KEY`, debe poder ejecutar funciones, ver la introspección o sincronizar la app.

## Flujo de datos

1. Un evento llega a Inngest (por ahora solo `plant/ping`).
2. Inngest hace POST firmado a `/api/inngest` en Vercel (`apps/web/src/app/api/inngest/route.ts`).
3. El SDK verifica la firma y corre la función de `packages/jobs`.
4. Para sincronizar, el dashboard o la integración de Vercel mandan un PUT firmado (in-band).

## Dónde se hace cumplir

- `packages/jobs/src/client.ts`: el modo dev (sin verificar firmas) sale de `NODE_ENV === "development"`, que Next fija en el build. `INNGEST_DEV` no lo puede prender.
- `packages/jobs/src/index.ts`: `serveOptions` con `enableUnauthedSync: false`.
- El SDK: verifica la firma HMAC con ventana de 5 minutos y responde 500 si falta la signing key.

## STRIDE

|       | Vector                                                                    | Control                                                                                                         |
| ----- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **S** | Un tercero manda un POST haciéndose pasar por Inngest                     | Firma HMAC obligatoria fuera de `next dev`                                                                      |
| **T** | Un PUT sin firmar re-registra la app con una URL sacada del header `Host` | `enableUnauthedSync: false`                                                                                     |
| **R** | No queda registro de quién disparó una función                            | Inngest guarda cada run; `audit_log` llega con las funciones que tocan datos                                    |
| **I** | Un GET sin firmar lee la introspección                                    | 401 sin firma válida                                                                                            |
| **D** | Requests sin firmar en masa                                               | Se rechazan antes de ejecutar; el body se parsea antes de verificar la firma, con el límite de 4,5 MB de Vercel |
| **E** | Una variable `INNGEST_DEV` en Vercel apaga las firmas                     | `isDev` fijado por `NODE_ENV`, no por la variable                                                               |

## Controles como quedaron

- **El endpoint usa esas opciones**: `apps/web/src/app/api/inngest/route.test.ts` prueba que la ruta desplegada rechaza un sync sin firma.
- **Firma obligatoria**: `packages/jobs/src/serve.test.ts` prueba que GET y POST sin firma devuelven 401 con `INNGEST_DEV=1`, y que un GET firmado responde 200.
- **Sin signing key falla cerrado**: el mismo test espera 500.
- **Sync sin firma apagado**: el mismo test prueba que un PUT sin firma no llama a Inngest y que un sync in-band firmado (el del dashboard) sigue funcionando.
- **Modo por `NODE_ENV`**: `packages/jobs/src/client.test.ts`.

## Riesgo residual

- Los previews de Vercel deben usar una signing key distinta de la de producción (un branch environment de Inngest). Lo configura Tomas al conectar Inngest con Vercel.
- `INNGEST_DEV`, `INNGEST_BASE_URL` o `INNGEST_API_BASE_URL` con una URL ya no apagan las firmas, pero sí redirigen el tráfico saliente (registro y eventos, con sus keys). Ninguna de las tres debe existir en Vercel.
- Sin telemetría hasta PLA-21: un pico de requests rechazados no avisa a nadie.
- La firma cubre el body, no los parámetros de la URL (`fnId`, `stepId`). Hoy no importa porque `ping` no toca datos, pero cuando haya varias funciones con service role, un body firmado capturado se podría reenviar a otra función dentro de los 5 minutos. Revisarlo con las funciones de Carga con IA.
