# Threat model: the MFA screens and turning TOTP off

Branch `claude/pla-76-mfa-screens-3imhqm` (PLA-76, third PR). Required by the PR template because the change touches MFA and sessions: it adds the first sensitive action, removing a user's factors. The gate the screens sit on (the hook, the RESTRICTIVE policies, `/auth/mfa`) is in `2026-10-08-mfa-gate.md`.

## Scope and assets

The user's second factor, and through it every row the RESTRICTIVE policies keep below `aal2`. In scope: turning TOTP off in Ajustes and the step-up before it. `/auth/mfa`, turning TOTP on and "Cerrar sesión en todos tus dispositivos" (part 2) appear only under residual risk. Out of scope: recovery codes (off), the "factor enrolled/unenrolled" mails (PLA-75), export and account deletion (PLA-58, PLA-84).

## Trust boundary

The browser holds the session cookie and sends the factor id and the TOTP code; Plant trusts neither. Supabase Auth verifies codes, holds the factors and signs tokens. The server action trusts only the verified claims and Auth's answer about the user.

## Data flow

1. Ajustes reads the factor list in the browser. The page reads the claims on the server and tells the card whether the step-up is needed.
2. Without a sign-in by mail or Google in the last 15 minutes, the dialog signs out on this device and sends the user to `/login?next=/settings?confirm=disable`; that sign-in and `/auth/mfa` bring them back with the dialog open.
3. The browser verifies a TOTP code with Auth (`challengeAndVerify`), which writes a fresh `totp` entry in the session's `amr`.
4. The browser calls `disableTotp(factorId)`. The server runs `requireSensitiveSession("disable_mfa")`, then `unenrollForSession`: a `totp` entry from the last two minutes, Auth's user equal to the session's, the id among that user's verified factors; it removes every verified factor, the verified one last, and refreshes the session.
5. Auth's triggers write `auth.mfa.factor_removed` per factor to `audit_log`; the server logs `auth.mfa.disable`.

## Where it is enforced

- **Server action:** `app/(app)/settings/actions.ts` (non-string id refused before the gate; the gate), `lib/auth/mfa-disable.ts` (fresh code, same user, own factor, verified factor last).
- **Rules:** `lib/auth/mfa-rules.ts` (`sensitiveRequirement`, `totpIsFresh`, one `amr` walk).
- **Lint:** only `mfa-disable.ts` may unenroll on the server, and it may hold no server action; enroll, challenge and verify stay in `mfa-browser.ts`.
- **Auth:** removing a verified factor needs `aal2`; verify is rate-limited per caller IP.

## STRIDE

|       | Vector                                                                                                                 | Control                                                                                                                                                                                                                                                                                                                             |
| ----- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **S** | A stolen `aal2` cookie turns TOTP off through Plant's UI.                                                              | The gate needs a sign-in by mail or Google from the last 15 minutes, and the server a TOTP code verified in the last two minutes. The code verified at `/auth/mfa` counts too, so a cookie taken within two minutes of the owner's own sign-in passes both; Auth's own unenroll already lets any `aal2` cookie do the same (E row). |
| **T** | The browser sends another user's factor id, a non-string, or skips the code.                                           | The id must be one of the session user's verified factors (`factor_not_found` otherwise); a non-string is refused before the gate; without a fresh `totp` entry nothing is removed (`totp_stale`). `mfa-disable.test.ts`.                                                                                                           |
| **R** | A factor removed with no trace.                                                                                        | `auth.mfa.factor_removed` per factor from the database trigger, whoever removed it; `auth.mfa.disable` and `auth.step_up` (`disable_mfa`) in the logs.                                                                                                                                                                              |
| **I** | The log line carries the code or a factor id.                                                                          | Only the request id, the user id, the outcome and two counts; `mfa-disable.test.ts` checks the ids are absent.                                                                                                                                                                                                                      |
| **D** | A removal stops halfway and leaves the user with factors they cannot see turned off.                                   | The verified factor goes last, so a stop leaves the session at `aal2`; `partial` says how many were removed and the card reloads the real state. After a full removal whose refresh failed, the old token still reads `aal2` until it expires and the next one reads no factor.                                                     |
| **E** | A direct call to Auth's unenroll from an `aal2` session skips the gate. A link with `?confirm=disable` turns TOTP off. | Auth allows the first, as for email change: the gate holds for Plant's UI, and the audit row records it. The link only opens the dialog, which still needs the step-up and a code.                                                                                                                                                  |

## Controls as built

- **Fresh-code rule:** `mfa-rules.test.ts` (fresh, a second too old, ahead of the server's clock, first-factor entries, malformed `amr`).
- **Gate and action:** `sensitive-session.test.ts` (`disable_mfa` denial logged), `actions.test.ts` (a non-string id and a denied gate make no Auth call).
- **Unenroll:** `mfa-disable.test.ts`, one case per outcome with its level and keys.
- **Lint fences:** `scripts/web-import-fences.test.mjs` (`mfa-disable.ts` may only unenroll and holds no server action).
- **Flow:** a local run with Chromium turned TOTP off within the window and after the step-up, landing back in Ajustes with the dialog open, with `auth.mfa.factor_removed` rows.

## Residual risk

- **A stolen `aal2` cookie can still unenroll the owner's factor and enroll its own through Auth's API** (two calls, no mailbox), and a stolen `aal1` session of a user without TOTP can enroll one: both lock the owner out. Detection is the `factor_removed` and `factor_verified` audit rows; countermeasures are the global sign-out on `/auth/mfa`, support's runbook (prove the mailbox, `auth.admin.mfa.deleteFactor`, global sign-out) and Auth's factor mails once PLA-75's SMTP is on.
- **A stolen `aal1` session can sign the owner out everywhere** (Auth's `/logout` allows it at any `aal`). Every TOTP verify, on enrolling, on `/auth/mfa` and in this dialog, deletes the user's other `aal1` sessions.
- **The step-up signs out before the mail arrives.** If the mail never comes (the staging mailer sends two per hour), the user is signed out on this device until it does. A mail link opened more than ten minutes later lands on Resumen instead of the dialog (the return path lives in a ten-minute cookie); the sign-in still counts for the step-up, so the switch works without another one.
- **Browser-side failures** (enroll, verify, Ajustes' factor list, the global sign-out) reach only Auth's logs until browser error reporting (PLA-88).
- **Recovery codes are off.** The hook would count one as enrolled; the card's "on" counts every verified factor, and the removal takes them all.
- **The frozen `production` branch has no `/auth/mfa`**, so an enrolled user signing in there sees nothing until the first promotion (PLA-13).
