# Threat model: perfiles, consentimientos y auditoría

PLA-16. Lo pide el disparador "Cambio en autenticación, sesión, MFA o RLS": son las primeras tablas con datos del usuario y sus políticas de RLS.

## Alcance y activos

- `public.profiles`: nombre visible y dólar de referencia (MEP o CCL). Una fila por usuario.
- `public.consents`: qué versión de términos, privacidad y envío a proveedores de IA aceptó o retiró cada usuario, y cuándo. Es la prueba del consentimiento que pide la Ley 25.326.
- `private.audit_log`: rastro de acciones sensibles (login, MFA, export, borrado, upload). Sin montos, tenencias, CUIT, DNI, CBU ni tokens.

Queda afuera quién escribe la auditoría (PLA-21) y el login (PLA-17).

## Frontera de confianza

El navegador habla con PostgREST con el JWT del usuario (rol `authenticated`) o sin sesión (`anon`). Todo lo que manda el cliente es no confiable: ids, columnas y valores.

## Flujo de datos

1. Al registrarse, el trigger `on_auth_user_created` crea el perfil.
2. `apps/web` lee y edita el perfil y registra consentimientos con supabase-js, como `authenticated`.
3. El servidor escribe `audit_log` desde PLA-21, fuera de la API.

## Dónde se hace cumplir

- RLS `user_id = (select auth.uid())` en `USING` y `WITH CHECK`.
- Grants por columna: el usuario solo edita `display_name` y `reference_dollar`, y en `consents` solo nombra `kind`, `version` y `granted`; `user_id` y `accepted_at` salen de los defaults.
- `REVOKE ALL` de `anon` y `authenticated` antes de cada grant, porque con "auto expose" apagado igual quedan TRUNCATE, REFERENCES, TRIGGER y MAINTAIN por default.
- `audit_log` en el schema `private`, sin `USAGE` para los roles de la API, y triggers que rechazan UPDATE, DELETE y TRUNCATE incluso al dueño.

## STRIDE

|       | Vector                                                    | Control                                                                                                                  |
| ----- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **S** | Registrar un consentimiento a nombre de otro              | `user_id` sin grant de INSERT y `WITH CHECK` contra `auth.uid()`                                                         |
| **T** | Editar o borrar un consentimiento o una fila de auditoría | Sin UPDATE ni DELETE en `consents`; triggers append-only en `audit_log`                                                  |
| **R** | Negar haber aceptado los términos                         | `consents` append-only con `accepted_at` puesto por la base                                                              |
| **I** | Leer el perfil o los consentimientos de otro              | RLS por `user_id`; `anon` sin privilegios                                                                                |
| **D** | Textos enormes en el perfil o la versión                  | `CHECK` de largo en `display_name`, `version`, `action` y `request_id`                                                   |
| **E** | Funciones invocables desde la API                         | Funciones en `private`, sin EXECUTE para `PUBLIC`, `anon` ni `authenticated`; `SECURITY DEFINER` con `search_path` vacío |

## Controles como quedaron

- **Piso del schema** (`supabase/tests/schema_rls_and_grants_test.sql`): toda tabla de `public` tiene RLS y grant a `authenticated`, las de `private` tienen RLS y ningún grant, `anon` no tiene privilegios y ninguna función es ejecutable por `anon`. Corre en el job `database` de CI en cada PR.
- **Aislamiento** (`profiles_consents_isolation_test.sql`): otro usuario no lee ni escribe perfiles ni consentimientos, ni puede cambiar el dueño o la fecha.
- **Auditoría** (`audit_log_test.sql`): ningún rol de la API la lee ni escribe, y nadie la modifica.

## Riesgo residual

- `audit_log` guarda el `user_id` después de borrar la cuenta (sin FK). Es un id opaco sin datos personales; se revisa con el abogado (PLA-56).
- Un superusuario de la base puede desactivar los triggers. Se acepta: es el mismo que administra Supabase.
