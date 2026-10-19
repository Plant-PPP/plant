# Threat model: adding market instruments to the catalog

Branch `feat/instrument-search`. Required by two template triggers: a grant changes (the service role may insert into `instruments`) and a new trust boundary (server actions that call IOL, CoinGecko and Kraken with text the user types, and write a table every user reads).

## Scope and assets

The global catalog `instruments`, which every user's holdings, movements, prices and alerts reference, and Plant's own IOL account, whose token reads the BYMA panels. No user data is read or written: the search and the add take a symbol, a market and search text, and no amounts, holdings or documents.

## Trust boundary

The browser sends search text, and a symbol and market to add. The providers' answers (IOL's panels, CoinGecko's search, Kraken's ticker) are external data. Only the server, through the service role, writes the catalog.

## Data flow

1. The picker calls `searchInstruments(query)` (`apps/web`, server action) after a pause in typing.
2. The action checks the session (`getSessionClaims`) and the per-user limit, then `catalogSearch().search` reads IOL's panels with Plant's token (kept six hours per instance) and asks Yahoo Finance's search and CoinGecko, and returns matching listings.
3. Picking a listing, or the operations review finding an import's instrument in the market, calls `addInstrument(symbol, market)`, which calls `addListedInstrument` (the instrument catalog sink).
4. The sink checks the session and its own limit, parses the symbol against the catalog's format and the market against `byma`, `us` or `crypto`, asks the provider again (`verify`: the BYMA panel lists it, Yahoo lists it on a US exchange as a stock or ETF, or CoinGecko names it and Kraken quotes it in dollars), and inserts the provider's symbol, name, type and currency with the service role, `ON CONFLICT DO NOTHING`.
5. The action reads the row back with the user's client (RLS) and returns it.
6. The quotes job reads `symbol, type, currency` of every instrument with the service role and prices them.

## Where it is enforced

- **Grants**: `service_role` may `SELECT (symbol, type, currency)` and `INSERT (symbol, name, type, currency)` on `instruments`, nothing else (no update or delete, no names or aliases read); `authenticated` keeps reading only. pgTAP pins both.
- **Lint fences**: only `instrument-catalog-sink.ts` holds the service role for this; only `instrument-actions.ts` imports it, and only `addListedInstrument`; the sink exports nothing else and holds no server action. `scripts/web-import-fences.test.mjs` proves each fence.
- **Server**: the session check, the limits (30 searches and 10 adds a minute per user), and the provider re-check in the sink.

## STRIDE

|       | Vector                                                                          | Control                                                                                                                                                                       |
| ----- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **S** | Calling the actions without a session                                           | `getSessionClaims` redirects to `/login` or `/auth/mfa` before anything runs                                                                                                  |
| **T** | A browser sends a made-up name, type or currency, or a symbol no provider lists | The sink takes only the symbol and market and writes what the provider answers; a symbol not listed is `not_listed`                                                           |
| **R** | Not knowing who added an instrument                                             | Each add logs `instruments.add` with the user id and outcome; the row itself carries no author                                                                                |
| **I** | Leaking Plant's IOL token or credentials, or what a user searches               | The token stays in the session object; errors are codes; the search text and results are never logged                                                                         |
| **D** | Flooding the providers or the catalog                                           | Per-user limits; the panels are cached; a symbol already there is kept; Kraken is checked before a crypto is added, so the quotes request never names a pair it does not know |
| **E** | Using the sink to write other tables or rows                                    | The grant covers four columns of one table, insert only; the fence keeps the sink out of every other file                                                                     |

## Controls as built

- **Provider re-check**: `instrument-catalog-sink.test.ts` (writes the provider's listing, refuses a symbol not listed or a malformed input without asking the provider, limits a user).
- **Search and verify**: `packages/core/src/catalog/listings.test.ts` (BYMA by panel, dollar bonds, CoinGecko ranking, Kraken check).
- **Grants**: `supabase/tests/holdings_isolation_test.sql` and `schema_rls_and_grants_test.sql`.

## Residual risk

- The limits are in memory per serverless instance, so many instances allow more; the catalog only grows by listings that exist, which bounds it.
- A listing's name comes from IOL or CoinGecko as they print it; it is plain text the UI escapes.
- A listing IOL later drops stays in the catalog and goes stale in the quotes; revisited if the catalog needs pruning.
