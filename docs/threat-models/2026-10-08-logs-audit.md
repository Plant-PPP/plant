# Threat model: logs and audit

Branch `claude/pla-21-logs-audit-940b43` (PLA-21). Required by the PR template because the change adds a migration with a `SECURITY DEFINER` trigger on an `auth` table and new logging of request data.

## Scope and assets

What leaves the app in a log line: request paths, Auth error codes, user ids, exception messages and stacks. What could reach them by accident: Auth's PKCE `code` and tokens, emails, CUIT, DNI and CBU, amounts and holdings. The audit trail itself (`private.audit_log`) and the availability of sign-in, which now depends on it. Out of scope: the Dash0 export (PLA-73), PostHog, client error reporting.

## Trust boundary

The request path and query, every request header (including a client's own `x-request-id` outside the proxy's matcher), the callback's `error` and `error_code` parameters, and the messages of errors thrown by Auth, libraries or our own code. The `auth.sessions` row comes from Supabase Auth, which runs as its own role.

## Data flow

1. `proxy.ts` mints a request id, checks the session and writes one `proxy.request` line to the function's console, which Vercel collects.
2. `/auth/callback` writes one `auth.callback` line per request.
3. An uncaught error in a page, route handler or server action reaches Next's `onRequestError`, which writes one `request.error` line.
4. Auth inserts an `auth.sessions` row on every new session; the `record_session_created` trigger inserts one `audit_log` row in the same transaction.
5. With `OTEL_EXPORTER_OTLP_ENDPOINT` or `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` set (not before PLA-73), `@vercel/otel` exports traces.

## Where it is enforced

- `credential-scrub.ts` and `server-log.ts`: every string scrubbed then cut, sensitive keys masked, flat values only, the logger's own keys written last.
- `no-console` in `apps/web` and every package: `serverLog` is the only way out.
- `private.record_session_created()`: fixed literals, only `NEW.*` as input, `search_path = ''`, no grants; the pgTAP floor pins it and the table it fires on.
- `audit_log`'s append-only triggers and missing grants (PLA-16).

## STRIDE

|       | Vector                                                                                                                                  | Control                                                                                                                                                                                                                                                                                                                                                 |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **S** | A client sends its own `x-request-id` to tie its noise to another request, or forges an audit row by inserting a session.               | The proxy replaces the header. Outside its matcher `onRequestError` keeps a client's UUID, so an error line can name another request; a non-UUID is dropped. No API role, `service_role` included, can insert into `auth.sessions` (pgTAP); the `service_role` key can still create a session through Auth's admin API, and its row reads as a sign-in. |
| **T** | Log injection: newlines or JSON in a path or message forge a second line or a field.                                                    | One `JSON.stringify` per line, flat values, the logger's keys last. `audit_log` is append-only.                                                                                                                                                                                                                                                         |
| **R** | A sign-in leaves no Plant record.                                                                                                       | Every new session writes `auth.session.created`; sign-out and MFA rows arrive with PLA-18.                                                                                                                                                                                                                                                              |
| **I** | A code, token, email or identity number ends up in a log: the callback query, an exception message, a stack, a field named for a value. | Query never logged by our lines; params masked raw or encoded; JWTs, bearer values and named tokens, keys, secrets and passwords masked; CBU, CUIT, DNI and emails masked, glued to a word in a file name or after a percent escape too; sensitive keys masked; values scrubbed before they are cut. Unit tests per pattern and per line.               |
| **D** | A hostile path makes scrubbing slow; logs grow without bound; a failing audit insert blocks sign-in.                                    | Linear patterns, bounded reads (4096 characters, 8192 for stacks) and timing tests. One line per proxied request. Fail-closed is a choice, see below.                                                                                                                                                                                                   |
| **E** | The definer trigger is used to write as its owner.                                                                                      | It takes no parameters, writes fixed values from the inserted row, has an empty `search_path` and no EXECUTE grant; firing a trigger is the only way to run it.                                                                                                                                                                                         |

## Controls as built

- **Scrubber**: `credential-scrub.test.ts` covers each param raw and encoded once and twice, a UUID `code`, each identity-number format, emails raw and encoded, what must survive (UUIDs, ISO dates and times, trace ids, hashes, chunk names, pnpm paths) and hostile inputs under a time limit.
- **Logger**: `server-log.test.ts` checks one JSON line per call, masked keys, scrubbing before the cut, the edge of a long value, the logger's own keys, trace ids and exceptions.
- **Callers**: `proxy.test.ts`, `route.test.ts` and `instrumentation.test.ts` check each outcome's line, that no query or code reaches it, and that a request id that is not a UUID is dropped.
- **Trigger**: `audit_session_created_test.sql` checks one row per new session and none per refresh, the closed vocabulary, that Auth's role cannot write the table itself and that no API role, `service_role` included, can insert a session; `audit_log_test.sql` and the floor's no-`USAGE` assert check that none can touch the table. The floor pins the definer, its owner, `search_path` and trigger definition. The pentest sign-ins in the CI `database` job go through Auth's real role, so a trigger that breaks sign-in fails CI and holds `deploy-migrations`.

## Residual risk

- **Sign-in is fail-closed.** If the audit insert fails, every sign-in fails. Detection is Supabase's Auth logs, an `auth.callback` `exchange_failed` line for Google and the mail link, and for the email code only a 500 from `/verify` in the browser, which Plant does not see until client error reporting. Accepted so a failing insert cannot leave a session unaudited.
- **A trigger that does not fire fails open.** Writes in `session_replication_role = replica` (a data restore) skip it, and Auth's own role owns `auth.sessions` and could drop or disable it in an upgrade. CI's floor catches a missing trigger against the CLI's Auth image only; nothing checks it on `plant-staging` at runtime.
- **The trigger depends on Auth's schema** (`auth.sessions.id` and `user_id`). An Auth upgrade that renames them breaks sign-in; `aal` is read through `to_jsonb`, so dropping it cannot.
- **The callback's `?code=` is in Vercel's request log**, and once traces are exported, in Next's root span (`http.target`). The code is single-use, short-lived and bound to the browser's PKCE verifier. PLA-73 adds a span processor that scrubs it before setting an endpoint.
- **Next prints its own unscrubbed line for uncaught errors**, next to ours. Our code does not put personal data in error messages.
- **The masks are a net.** A value with no recognisable shape (a name, an amount in a free-text message) passes, and so does a DNI (7 or 8 digits) inside a hex id of 16 or more characters, glued to a UUID, after a time's dot (read as its fraction) or after a version number and a dot, and a CUIT or CBU inside a hex id that holds other digits too; the rule is still never to log values.
- **Vercel Hobby keeps logs for one hour.** Enough for the done condition; retention arrives with Dash0 (PLA-73).
