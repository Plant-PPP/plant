# Threat model: exchange API keys and syncs

Branch `feat/pla-65-exchange-api` (PLA-65). Required by the PR template: a new provider that processes user data (Binance), a new trust boundary (a third-party credential the user hands Plant) and a change in RLS and grants (`account_api_keys`, `imports`).

## Scope and assets

- A Binance API key and its secret, which can read the user's spot balances. Plant takes only keys that read; a key that could trade, withdraw or transfer is refused, so a leaked stored key exposes balances, not funds.
- The balances read, as an import draft the user reviews: units per asset.
- Left out: other exchanges and brokers, Earn and futures wallets, trades.

## Trust boundary

- The key and secret come from the browser, typed by the user.
- Binance's answers (permissions and balances) come from a provider Plant does not control, over HTTPS.
- The sealed key crosses from the app (which seals it) to the database and from there to the import job (which opens it).

## Data flow

1. On an exchange account's page, the user types the key and secret; the `connectApiKey` server action parses them, checks the account is theirs and open, and asks Binance what the key may do (`/sapi/v1/account/apiRestrictions`, a signed GET).
2. A read-only key is sealed with AES-256-GCM under `CONNECTION_SECRETS_KEY`, bound to the user, account and exchange, and inserted into `public.account_api_keys` as the user, under RLS. The browser gets back only `{ ok }`; the page shows the key's last four characters.
3. "Sincronizar" (`syncAccount`) inserts an import naming the account and exchange, as the user; the `imports_guard_sync` trigger checks a key of that exchange on an open account and none in flight. It sends `plant/import.requested`.
4. `/api/inngest`'s import-document job loads the import as service_role filtered by import and user, reads the sealed key filtered by user, account and exchange, opens it, asks Binance again what it may do, reads `/api/v3/account` and saves the balances as a draft. The key never leaves the step.
5. The user reviews and confirms the draft as any import (`confirm_import`).

## Where it is enforced

- RLS owner policy and the MFA gate on `account_api_keys`; column grants keep `secret_ciphertext` insert-only for `authenticated`.
- Composite foreign keys tie a key and a sync to an account of the same user.
- `private.guard_sync_import` (runs as the caller) on every import without a document.
- The server actions (`lib/connections/write.ts`) and the job (`import-document.ts`), which re-check ownership and permissions.
- `secret-box.ts`: sealing bound to its context.

## STRIDE

| | Vector | Control |
|---|---|---|
| **S** | A user connects a key to, or syncs, another user's account | Composite FKs and the sync guard; pgTAP `account_api_keys_test.sql`, pentest `account-api-keys.pentest.test.ts` |
| **T** | A sealed key copied onto another user's row, or edited | UPDATE granted only on the key's own columns, under the owner policy; the seal is bound to user, account and exchange, so it does not open elsewhere (`secret-box.test.ts`, `import-store.test.ts`) |
| **R** | A key connected or a sync started with no trace | `connections.api_key` and `imports.read` log lines with the user id and outcome, never the key |
| **I** | The key or secret read back by the browser, logged, or left in a step's output | No SELECT on `secret_ciphertext` for `authenticated`; nothing returns it; tests check logs and step outputs carry neither |
| **D** | A user floods syncs | One sync in flight per account; the job runs one import at a time per user; Binance's own rate limit on the user's key |
| **E** | A key that can trade or withdraw lets Plant, or whoever steals the database and the server key, move funds | Refused at connect and again on every sync, on any permission besides reading; Plant calls only signed GETs |

## Controls as built

- **Read-only only**: `binanceSource.checkReadOnly` refuses a key where any field but the five that grant nothing or only reading is anything but literally `false` (`binance.test.ts`).
- **Sealed at rest**: AES-256-GCM, random IV, additional data `plant.account_api_keys:<user>:<account>:<provider>` (`secret-box.test.ts`).
- **Not readable by the user's role**: column grants (`account_api_keys_test.sql`, pentest "nobody reads a sealed key").
- **Owner isolation**: pgTAP and the pentest spec; the job filters by user and account (`import-store.test.ts`).
- **No secret in logs or step output**: `write.test.ts`, `import-document.test.ts`.

## Residual risk

- Whoever holds both the database and `CONNECTION_SECRETS_KEY` can open every key; they read balances only. Rotating the server key means asking users to connect again; there is no re-seal yet.
- A key the user widens in Binance after a sync stays stored until the next sync refuses it; the stored key cannot be used by Plant to trade either way.
- Binance's permission list may gain fields; an unknown field is treated as a permission, which may refuse a harmless key until the check learns it.
