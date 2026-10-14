const readLedger = jest.fn();
const readHoldings = jest.fn();
const read = jest.fn();
const notFound = jest.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});

jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("next/navigation", () => ({ notFound: () => notFound() }));
jest.mock("@/lib/auth/session-claims", () => ({
  getSessionClaims: async () => ({ sub: "u1" }),
}));
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
jest.mock("@/lib/request-id-server", () => ({
  currentRequestId: async () => undefined,
}));
jest.mock("@/lib/holdings/read", () => ({
  readHoldings: (...args: unknown[]) => readHoldings(...args),
  readReferenceDollar: async () => "ccl",
}));
jest.mock("@/lib/ledger/read", () => ({
  ...jest.requireActual("@/lib/ledger/read"),
  readLedger: (...args: unknown[]) => readLedger(...args),
}));
jest.mock("@/lib/quotes/quote-reader", () => ({
  createQuoteReader: () => ({ read }),
}));
jest.mock("@/components/holdings/scope-page", () => ({
  ScopePage: () => null,
}));
jest.mock("@/lib/connections/write", () => ({
  readApiKey: async () => null,
}));

import type * as React from "react";

import * as apiKeyActions from "@/app/(app)/(data)/accounts/api-key-actions";
import * as movementActions from "@/app/(app)/(data)/assets/movement-actions";
import type { HoldingRow } from "@/lib/holdings/read";
import { holdingsView, writeOperation } from "@/lib/ledger/ledger";
import {
  ACCOUNT,
  emptyLedger,
  OTHER_PORTFOLIO,
  PORTFOLIO,
  PURCHASE,
} from "@/lib/ledger/ledger-fixture.test-support";
import { captureServerLog } from "@/lib/log/capture-server-log";
import { nonActionFunctions } from "@/test/client-props";

import { ScopeView } from "./scope-view";

const bought = writeOperation(emptyLedger(), PURCHASE, {
  operationId: "0f000000-0000-4000-8000-00000000000f",
  newId: () => crypto.randomUUID(),
}).state;

type Props = {
  scope: { kind: string; id: string };
  rows: HoldingRow[];
  soldRows: HoldingRow[];
  unit: string;
  revision: string;
};

let lines: Record<string, unknown>[];
beforeEach(() => {
  lines = captureServerLog();
  notFound.mockClear();
  readLedger.mockResolvedValue({
    ledger: bought,
    truncated: false,
    symbolOf: new Map(),
  });
  readHoldings.mockResolvedValue(holdingsView(bought));
  read.mockResolvedValue({ fxRates: [], prices: [] });
});

const render = async (
  kind: "account" | "portfolio",
  id: string,
  params: Record<string, string> = {},
) => (await ScopeView({ kind, id, params })) as React.ReactElement<Props>;

it("shows a portfolio's holdings only, in the reference dollar", async () => {
  const page = await render("portfolio", OTHER_PORTFOLIO);
  expect(page.props.scope).toEqual({
    kind: "portfolio",
    id: OTHER_PORTFOLIO,
    name: "Largo plazo",
  });
  expect(page.props.rows.map((row) => row.portfolio.id)).toEqual([
    OTHER_PORTFOLIO,
  ]);
  expect(page.props.unit).toBe("usd_ccl");
  expect(lines.at(-1)).toMatchObject({
    event: "scope.view",
    "plant.scope.kind": "portfolio",
    "plant.assets.holding_count": 1,
  });
});

it("shows every holding of an account, in the unit ?unit names", async () => {
  const page = await render("account", ACCOUNT, { unit: "ars" });
  expect(page.props.scope).toMatchObject({ institution: "IOL" });
  expect(page.props.rows).toHaveLength(2);
  expect(page.props.unit).toBe("ars");
});

it("lists a holding sold out apart from the open ones", async () => {
  const open = holdingsView(bought).active;
  const sold = open.find((row) => row.portfolio.id === PORTFOLIO)!;
  readLedger.mockResolvedValue({
    ledger: {
      ...bought,
      holdings: bought.holdings.map((each) =>
        each.holding.id === sold.id ? { ...each, closed: true } : each,
      ),
    },
    truncated: false,
    symbolOf: new Map(),
  });
  readHoldings.mockResolvedValue({
    ...holdingsView(bought),
    active: open.filter((row) => row.id !== sold.id),
  });
  const page = await render("portfolio", PORTFOLIO);
  expect(page.props.rows).toEqual([]);
  expect(page.props.soldRows.map((row) => row.id)).toEqual([sold.id]);
});

it("hands the page and the connection card only data and server actions", async () => {
  const page = await render("account", ACCOUNT);
  const { connection, ...props } = page.props as typeof page.props & {
    connection: React.ReactElement<Record<string, unknown>>;
  };
  expect(nonActionFunctions(props, [movementActions])).toEqual([]);
  // The account is at IOL, which connects by API.
  expect(connection.props.form).toMatchObject({ provider: "iol" });
  expect(nonActionFunctions(connection.props, [apiKeyActions])).toEqual([]);
});

it.each([
  ["an id that is not one", "portfolio", "p1"],
  ["a portfolio the user does not have", "portfolio", ACCOUNT],
  ["an account the user does not have", "account", PORTFOLIO],
] as const)("has no page for %s", async (_, kind, id) => {
  await expect(render(kind, id)).rejects.toThrow("NEXT_NOT_FOUND");
});

it("has no page for an archived portfolio", async () => {
  readLedger.mockResolvedValue({
    ledger: {
      ...bought,
      portfolios: bought.portfolios.filter(({ id }) => id !== OTHER_PORTFOLIO),
      archivedPortfolios: [{ id: OTHER_PORTFOLIO, name: "Largo plazo" }],
    },
    truncated: false,
    symbolOf: new Map(),
  });
  await expect(render("portfolio", OTHER_PORTFOLIO)).rejects.toThrow(
    "NEXT_NOT_FOUND",
  );
});
