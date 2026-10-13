import { rest } from "./pentest-helpers";
import type { TestUser } from "./pentest-users";
import { createRow, principalOf } from "./portfolio-setup-rows";

// The revision of each of the user's holdings of a symbol, as write_operation
// expects them.
export async function revisionsOf(
  user: TestUser,
  symbol: string,
): Promise<Record<string, number>> {
  const res = await rest(
    user,
    "GET",
    `holdings?instrument_symbol=eq.${symbol}&select=id,movements_revision`,
  );
  expect(res.status).toBe(200);
  return Object.fromEntries(
    (res.body as { id: string; movements_revision: number }[]).map((row) => [
      row.id,
      row.movements_revision,
    ]),
  );
}

// A purchase of one unit of a symbol in an account's principal portfolio.
export function purchaseOf(
  account: string,
  portfolio: string,
  symbol: string,
): Record<string, unknown> {
  return {
    source_connection_id: account,
    portfolio_id: portfolio,
    instrument_symbol: symbol,
    kind: "purchase",
    date: "2026-01-02",
    currency: "ARS",
    quantity: "1",
    price: "100",
    rates: {},
  };
}

export async function writeOperation(
  user: TestUser,
  operationId: string | null,
  parts: unknown[],
  symbol: string,
): Promise<{ status: number; body: unknown }> {
  return rest(user, "POST", "rpc/write_operation", {
    body: {
      p_operation_id: operationId,
      p_parts: parts,
      p_expected: await revisionsOf(user, symbol),
    },
  });
}

// An account of the user's own with one purchase of a symbol in it: the
// operation, the holding it opened and the account.
export async function boughtIn(
  user: TestUser,
  symbol: string,
): Promise<{ operation: string; holding: string; account: string }> {
  const principal = await principalOf(user);
  const account = await createRow(user, "source_connections", {
    institution: "Balanz",
    default_portfolio_id: principal,
  });
  const res = await writeOperation(
    user,
    null,
    [purchaseOf(account, principal, symbol)],
    symbol,
  );
  expect(res.status).toBe(200);
  const holding = await rest(
    user,
    "GET",
    `holdings?source_connection_id=eq.${account}&select=id`,
  );
  const [row] = holding.body as { id: string }[];
  return { operation: res.body as string, holding: row!.id, account };
}

// Deletes the operation, which deletes the holding it opened, and archives
// the account.
export async function sellOff(
  user: TestUser,
  bought: { operation: string; account: string },
  symbol: string,
): Promise<void> {
  const res = await writeOperation(user, bought.operation, [], symbol);
  expect(res.status).toBe(200);
  const archived = await rest(
    user,
    "PATCH",
    `source_connections?id=eq.${bought.account}`,
    { body: { archived_at: new Date().toISOString() } },
  );
  expect(archived.status).toBe(204);
}
