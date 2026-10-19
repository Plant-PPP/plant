# Threat model: cash with a history and a broker's movements export

Branch `feat/cash-history`. Required by the PR template: a new table with financial data (`cash_movements`), RLS and grants, a new RPC, and a new user-supplied file the server reads.

## Scope and assets

Each cash holding's history (amounts, dates, a broker's movement numbers, notes) and the holding's amount it moves; the operations it links to. Left out: the export file itself, which is read in memory and never stored.

## Trust boundary

The export is text from the user's browser, up to 5 MB, parsed on the server (`readIolMovements`). The cash form's fields come from the browser too. Both reach the database only through `write_cash_movements`, as the user.

## Data flow

1. The account page's dialog reads the file in the browser and sends its text to the `importAccountStatement` server action (preview, then confirm).
2. `lib/cash/write.ts` parses it with regular expressions over the table (no HTML engine, no scripts), reads the user's ledger and cash under RLS, plans what to write (`lib/cash/statement.ts`), writes missing operations through `write_operation` and each currency's movements through `write_cash_movements`.
3. The closes read `cash_movements` under RLS (`lib/cash/read.ts`).

## Where it is enforced

- RLS on `cash_movements` (`user_id = auth.uid()` in `USING` and `WITH CHECK`) plus the MFA restrictive policy; `REVOKE ALL`, column `INSERT` and `DELETE` only to `authenticated`, nothing on `user_id`, nothing to `anon`.
- Composite foreign keys `(user_id, holding_id)` and `(user_id, operation_id)`: a movement never names another user's holding or operation.
- `private.written_through('plant.cash_movement')`: writes only through the RPC.
- `write_cash_movements` runs as the caller with an empty `search_path`, takes the user's lock, refuses another user's or a missing holding (`not_found`), a leg of another account's operation (`other_account`), a history without its opening or with a movement before it (`before_opening`), a balance below 0 (`negative_cash`) and more than 2000 rows a call.
- The server action parses its input with zod, bounds the file and the row count, and logs ids, counts and outcomes, never amounts.

## STRIDE

|       | Vector                                                                                | Control                                                                                           |
| ----- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **S** | Writing as another user                                                               | Session claims; RLS and composite keys bind every row to `auth.uid()`                             |
| **T** | Pointing a movement at another user's holding or operation; forging the amount column | Composite foreign keys; the RPC alone writes and moves the amount; `user_id` not granted          |
| **R** | Denying an import                                                                     | Each write is logged with the request id, user and counts                                         |
| **I** | Reading another user's history                                                        | RLS; pentest spec reads B's rows as A                                                             |
| **D** | A huge or crafted file                                                                | 5 MB and 5000-row caps before parsing; linear regular expressions; at most 2000 rows per RPC call |
| **E** | Running the RPC with more rights                                                      | `SECURITY INVOKER`, empty `search_path`, EXECUTE only to `authenticated`; floor test lists it     |

## Controls as built

- **Isolation and RPC rules**: `supabase/tests/cash_movements_isolation_test.sql`.
- **Another user and anon**: `security-tests/src/cash-movements.pentest.test.ts`.
- **Floor**: `supabase/tests/schema_rls_and_grants_test.sql` lists `write_cash_movements` among the caller-run RPCs.
- **Parser**: `packages/sources/src/file-upload/iol-movements.test.ts` (made-up fixture).

## Residual risk

A sync or a hand edit that sets a cash amount shifts that cash's past days, as before cash had a history; accepted, since today's balance comes from the broker. The import is not atomic across operations and cash: a failure part way leaves what was written, and reading the file again completes it without writing anything twice.
