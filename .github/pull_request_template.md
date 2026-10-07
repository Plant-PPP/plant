<!--
Título: Conventional Commits, menos de 70 caracteres (por ejemplo `feat(web): carga manual de tenencias`).
Migración destructiva: el título arranca con `[DESTRUCTIVE]`.
Borrá las secciones que no apliquen.
-->

## Intent

_Qué cambia, por qué y qué ve el usuario. Describí el estado final, no cómo se llegó._

Linear: PLA-

## Seguridad

> [!IMPORTANT]
> Un cambio es **sensible** si toca: auth, sesiones o MFA, RLS o grants, exportar o borrar datos, la subida o lectura de archivos, un proveedor nuevo, un campo nuevo con datos financieros o personales (CUIT, DNI, CBU, montos, tenencias), o prompts de IA que incluyen datos del usuario.

- [ ] No es sensible
- [ ] Es sensible: completá abajo

**Qué datos toca y quién puede verlos después del cambio:**

**STRIDE, qué podría salir mal:**

### ¿Hace falta threat model?

> [!WARNING]
> Si marcás alguna, va un threat model en `docs/threat-models/` (partí de `_template.md`).

- [ ] Ninguna aplica
- [ ] Endpoint nuevo o cambio de frontera de confianza
- [ ] Campo nuevo con datos financieros o personales
- [ ] Dependencia o proveedor nuevo que procesa datos del usuario (incluye un proveedor o caso de uso de IA nuevo)
- [ ] Cambio en autenticación, sesión, MFA o RLS
- [ ] Subida, importación o exportación nueva controlada por el usuario

**Threat model:**

## Verificación

**Cómo lo probé (comandos, URL de staging, capturas):**

- [ ] Tests de aislamiento por usuario (pgTAP) para cada tabla nueva con datos del usuario (o `n/a`)
- [ ] Sin `.env`, keys, documentos reales ni datos personales en el diff

## Migración

> [!CAUTION]
> Las migraciones destructivas (drop de columna o tabla, achicar un tipo) llevan `[DESTRUCTIVE]` en el título **y** un plan de vuelta atrás.

- [ ] No destructiva
- [ ] Destructiva: título con `[DESTRUCTIVE]`

**Plan de vuelta atrás:**

## IA

- [ ] Un asistente de IA escribió código en rutas sensibles (auth, RLS, migraciones, dependencias, CI): qué generó
- [ ] Agrega o cambia llamadas a un proveedor de IA: costo registrado con `ai-cost.ts` y texto de afuera por `prompt-text.ts` (los dos llegan con la primera llamada a IA)
