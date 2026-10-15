import { expectError, rest } from "./pentest-helpers";
import type { TestUser } from "./pentest-users";
import {
  archiveRow,
  createRow,
  hintOf,
  principalOf,
} from "./portfolio-setup-rows";

export type DebtSetup = {
  account: string;
  debt: string;
  cash: string;
  event: string;
};

// A dollar loan, a dollar cash holding in an account of its own and a payment
// on the loan, for one user.
export async function debtWithPayment(user: TestUser): Promise<DebtSetup> {
  const principal = await principalOf(user);
  const account = await createRow(user, "source_connections", {
    institution: "IOL",
    default_portfolio_id: principal,
  });
  const cash = await createRow(user, "holdings", {
    source_connection_id: account,
    portfolio_id: principal,
    asset_class: "cash",
    currency: "USD",
    amount: 1000,
  });
  const res = await rest(user, "POST", "liabilities", {
    body: {
      kind: "usd_debt",
      label: "Préstamo pentest",
      currency: "USD",
      balance: 5000,
      opened_on: "2026-01-01",
    },
    headers: { Prefer: "return=representation" },
  });
  expect(res.status).toBe(201);
  const [row] = res.body as { id: string }[];
  const debt = row!.id;
  const event = await recordPayment(user, debt);
  return { account, debt, cash, event };
}

// Deletes the loan and archives its cash and account, which would otherwise
// keep the user's principal portfolio from being archived by other specs.
export async function removeDebtSetup(
  user: TestUser,
  setup: DebtSetup,
): Promise<void> {
  const res = await rest(user, "DELETE", `liabilities?id=eq.${setup.debt}`);
  expect(res.status).toBe(204);
  await archiveRow(user, "holdings", setup.cash);
  await archiveRow(user, "source_connections", setup.account);
}

export async function recordPayment(
  user: TestUser,
  debt: string,
  cash: unknown = null,
): Promise<string> {
  const res = await rest(user, "POST", "rpc/record_liability_event", {
    body: {
      p_liability_id: debt,
      p_event: { kind: "payment", date: "2026-02-01", amount: "10" },
      p_cash: cash,
    },
  });
  expect(res.status).toBe(200);
  return res.body as string;
}

// B's id and one that does not exist answer alike.
export function expectNotFound(res: { status: number; body: unknown }): void {
  expectError(res, 404, "PT404");
  expect(hintOf(res)).toBe("not_found");
}
