# Threat model: connectors and their credentials in Vault

Branch `feat/pla-155-connector-port` (PLA-155, PLA-156, PLA-157, PLA-158, PLA-160). Required by the PR template: new providers that process user data (Wallbit, Interactive Brokers, Nexo Pro, InvertirOnline), a trust boundary change (credentials move from an app-sealed column to Supabase Vault), and new SECURITY DEFINER functions and grants. It supersedes the sealing parts of `2026-10-14-exchange-api-keys.md`.

## Scope and assets

- Each account's credentials for its provider: a Binance key and secret, a Wallbit key, an IBKR Flex token and query id, a Nexo Pro key and secret, an IOL username and password. All but IOL's can only read, by the provider's design or the user's choice; IOL's can trade.
- The holdings and operations read, as an import draft only its owner sees.

## Trust boundary

- Credentials come from the browser, typed by the user, through a server action, to PostgREST, as the user.
- The database moves them into Vault as the owner; only service_role reads them back, through one function.
- The providers' answers (JSON, IBKR's XML) are untrusted input to the adapters.

## Data flow

1. The card posts `{ accountId, provider, credentials, confirmedReadOnly }` to `connectApiKey`. It parses them with the provider's schema, requires the read-only confirmation where the provider does not tell, checks the account is the user's, open and at that provider, and calls the provider's `check`.
2. It updates the account's row, or inserts one, with `credentials`. `private.store_account_credentials` (BEFORE INSERT OR UPDATE, definer, empty search path) refuses unless `auth.uid()` is the row's user and owns the open account, then calls `vault.create_secret` or `vault.update_secret`, stores the secret's id in `vault_secret` and nulls `credentials`; a check keeps `credentials` null at rest.
3. A sync inserts an import with `sync_draft`; the job, as service_role, calls `public.account_credentials(user, account, provider)` and the provider's adapter reads with them, inside one step.
4. Deleting the key, or the account, runs `private.delete_account_credentials`, which deletes the Vault secret.

## Where it is enforced

- Column grants on `account_api_keys` (authenticated never reads `credentials`, `vault_secret` or `secret_ciphertext`); the owner policy and MFA gate; the transient check.
- The definer trigger's authorization from the session.
- `account_credentials` executable by service_role only.
- The server actions and each adapter's schema; the contract tests.

## STRIDE

| | Vector | Control |
|---|---|---|
| **S** | A user stores credentials on, or syncs, another user's account | The trigger authorizes from `auth.uid()` and the account's owner; composite keys; pgTAP `account_api_keys_test.sql`, pentest `account-api-keys.pentest.test.ts` |
| **T** | A user points their row at another user's Vault secret | `vault_secret` is granted to nobody and the trigger keeps it on update |
| **R** | Credentials stored or a sync started with no trace | `connections.api_key` and `imports.read` log lines with user, provider and outcome, never a credential |
| **I** | Credentials read back by a user, kept in the row, logged or in a step's output | No grant on the columns or on Vault (pgTAP), `credentials` always null (check), `account_credentials` only for service_role (pentest `account-credentials.pentest.test.ts`); adapters keep secrets out of URLs and errors (contract tests), except IBKR's token, which Flex takes in the query string: the fetch instrumentation does not trace Flex URLs and a span processor masks `t=` in any span that names one (`instrumentation.ts`) |
| **D** | A slow provider or a never-ready IBKR statement holds the job | Timeouts per request; an IBKR read stops within a 30 s budget, waits included, and fails for the job's retry; one import at a time per user |
| **E** | Plant trading with credentials that can | Adapters call only GETs (and IOL's token POST), proved by the contract tests; Binance refuses keys that can do more; Wallbit refuses a key it lists `trade` for |

## Controls as built

- **Vault at rest**: the database's own encryption; nothing in the app holds a key.
- **Write-only credentials**: column grants and the null check.
- **Read back only by the job**: `account_credentials`, filtered by user, account and provider.
- **Read-only calls**: the contract battery's method check for every adapter.

## Residual risk

- Whoever controls the database (or service_role) can read every credential, IOL's password included, which can trade. Accepted by Tomas for IOL; the card says so.
- Wallbit and Nexo Pro cannot be asked what a key may do; a key made with more than reading is stored on the user's word. Plant never calls a trading endpoint either way.
- IBKR's token travels in the URL to IBKR, as Flex requires; it can only run reports. Traces skip and mask it; IBKR's and any proxy's own logs are out of Plant's reach.
- The providers' shapes for Wallbit trades, Nexo Pro balances and IOL's account state are taken from their documentation and an unofficial client, not from real accounts.
