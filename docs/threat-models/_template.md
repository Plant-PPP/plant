# Threat model: <qué cambia>

Rama `<tipo>/pla-<n>-<slug>` (PLA-<n>). Qué disparador del template de PR lo pide y por qué.

## Alcance y activos

Qué datos y capacidades protege este cambio (tenencias, montos, documentos subidos, sesión, CUIT/DNI/CBU) y qué queda afuera.

## Frontera de confianza

Dónde entra texto o datos que no controlamos (archivo subido, input del usuario, respuesta de un modelo, webhook) y quién está de cada lado.

## Flujo de datos

Paso a paso, desde el navegador hasta la base y los proveedores externos. Nombrá cada componente (`apps/web`, `/api/inngest`, Storage, Gemini, Anthropic).

## Dónde se hace cumplir

Cada control y la capa en la que vive: RLS y grants, `proxy.ts`, route handler, paso del job, prompt.

## STRIDE

| | Vector | Control |
|---|---|---|
| **S** | Suplantación | |
| **T** | Manipulación | |
| **R** | Repudio | |
| **I** | Divulgación de información | |
| **D** | Denegación de servicio | |
| **E** | Elevación de privilegios | |

## Controles como quedaron

- **<control>**: qué hace y qué test lo prueba.

## Riesgo residual

Lo que queda abierto, por qué se acepta y cuándo se revisa.
