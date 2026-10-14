# Threat model: Roxom, Mercado Pago, Bitso and Ripio Trade connectors

Branch `feat/pla-162-more-connectors` (PLA-162). Required by the PR template: four new providers that process user data. They run on the port, Vault storage and job of `2026-10-14-connectors-vault.md`, which still holds; this covers only what is new.

## Scope and assets

- Roxom: an API key id and the user's RSA private key. Roxom keys cannot be limited to reading.
- Mercado Pago: the user's production access token, which has every permission on the account (payments, transfers to the extent the API allows).
- Bitso: key and secret the user is asked to make with only "View balances" and "View account information".
- Ripio Trade: API token and secret key the user is asked to make with only "Read" access.
- The holdings read, as an import draft only its owner sees.

## Trust boundary

Unchanged: credentials go browser → server action → PostgREST → Vault, and only the job reads them back. New: Mercado Pago's report is a CSV file downloaded from Mercado Pago and parsed by the adapter, untrusted input like the providers' JSON.

## STRIDE

|       | Vector                                                                      | Control                                                                                                                                                                                                                                                                                                           |
| ----- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **S** | Credentials for one provider stored on an account of another                | Unchanged: the server matches the account's institution to the provider                                                                                                                                                                                                                                           |
| **T** | A report file name from Mercado Pago's list steering the download elsewhere | The name must match `[A-Za-z0-9._-]{1,200}` and is appended to the fixed report path on the fixed base URL; redirects are refused                                                                                                                                                                                 |
| **R** | Unchanged                                                                   | `connections.api_key` and `imports.read` lines, never a credential                                                                                                                                                                                                                                                |
| **I** | The private key or a token logged, in a URL or in an error                  | Secrets go only in headers or are used to sign; the contract tests check URLs and error messages for every secret field; the PEM is parsed in memory and never logged                                                                                                                                             |
| **D** | A Mercado Pago report never generated holds the job; a huge file            | The read stops within a 30 s budget, waits included, and fails for the job's retry; a file over 5 M characters is refused                                                                                                                                                                                         |
| **E** | Plant trading or moving money with credentials that can                     | Adapters call only GETs, plus Mercado Pago's report request, the one declared POST, proved by the contract tests. Roxom's and Mercado Pago's credentials can do more by design: the user confirms they understand. Bitso and Ripio cannot be asked what a key may do: the user confirms the read-only permissions |

## Residual risk

- Roxom's private key and Mercado Pago's token can trade or move money; whoever controls the database (or service_role) can read them from Vault. Same accepted risk as IOL's password; the card says so.
- Bitso keys and Ripio tokens made with more than reading are stored on the user's word.
- Shapes not confirmed against real accounts: Roxom's signed path (its docs show `/api/v1/...` in one example and `/v1/...` in the OpenAPI), which balances its endpoint covers (the trading account, the funding account or both), Mercado Pago's report list (where the file name and status come) and which line of the report closes with the balance, and Ripio's signed path (with or without `/v4`).
