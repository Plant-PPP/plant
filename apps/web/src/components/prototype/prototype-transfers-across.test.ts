import { exactOf, plus, stored } from "@plant/shared";

import { lineLabel } from "@/lib/holdings/messages";
import { operationInputSchema } from "@/lib/holdings/schemas";
import { buildFixtures } from "@/lib/prototype/fixtures";

import {
  groupOf,
  holdingIn,
  initialState,
  movementsPage,
  operationOf,
  type PrototypeState,
  stepsOf,
  writeOperation,
} from "./prototype-store";

const TODAY = "2026-10-12";
const fixtures = buildFixtures(TODAY);
const state = initialState(fixtures, TODAY);

const accountId = (institution: string) =>
  fixtures.accounts.find((row) => row.institution === institution)!.id;
const IOL = accountId("IOL");
const COCOS = accountId("Cocos");
const [PRINCIPAL, LARGO] = fixtures.portfolios.map((row) => row.id) as [
  string,
  string,
];
const TRANSFER = "e5000000-0000-4000-8000-000000000001";
let ids = 0;
const options = (operationId = TRANSFER) => ({
  operationId,
  newId: () =>
    `e6000000-0000-4000-8000-${String((ids += 1)).padStart(12, "0")}`,
});

// Apple, held in IOL's Principal, moved to an account that holds none.
const across = (
  quantity: string,
  {
    to = COCOS,
    portfolio = PRINCIPAL,
  }: { to?: string; portfolio?: string } = {},
) => ({
  kind: "transfer",
  source_connection_id: IOL,
  instrument_symbol: "AAPL",
  date: TODAY,
  currency: "ARS",
  reference: null,
  note: null,
  parts: [
    { portfolio_id: PRINCIPAL, direction: "out", quantity },
    {
      portfolio_id: portfolio,
      source_connection_id: to,
      direction: "in",
      quantity,
      price: null,
    },
  ],
});

const apple = (s: PrototypeState, account: string, portfolio: string) =>
  holdingIn(s, account, "AAPL", portfolio);
const position = (s: PrototypeState, account: string, portfolio: string) => {
  const held = apple(s, account, portfolio);
  return held ? stepsOf(s, held.holding.id, "ars").at(-1)!.position : null;
};
const written = (input: unknown, from = state) => {
  const write = writeOperation(from, input, options());
  expect(write.result).toEqual({ ok: true, id: TRANSFER });
  return write.state;
};

describe("a transfer to another account", () => {
  const before = position(state, IOL, PRINCIPAL)!;
  const moved = written(across("2"));

  it("moves the units with their cost to that account, and makes no result", () => {
    expect(apple(state, COCOS, PRINCIPAL)).toBeUndefined();
    const left = position(moved, IOL, PRINCIPAL)!;
    const arrived = position(moved, COCOS, PRINCIPAL)!;
    expect(arrived.quantity).toBe("2");
    expect(apple(moved, COCOS, PRINCIPAL)!.holding.amount).toBe("2");
    expect(
      stored(plus(exactOf(left.money!.cost), exactOf(arrived.money!.cost))),
    ).toBe(before.money!.cost);
    expect(left.money!.realized).toBe(before.money!.realized);
    expect(arrived.money!.realized).toBe("0");
  });

  it("replays the instrument's holdings of both accounts together", () => {
    const arrived = apple(moved, COCOS, PRINCIPAL)!.holding.id;
    expect(groupOf(moved, apple(moved, IOL, PRINCIPAL)!.holding.id)).toContain(
      arrived,
    );
  });

  it("belongs to the account the units leave, and names the other on each line", () => {
    const operation = operationOf(moved, TRANSFER)!;
    expect(operation.accountId).toBe(IOL);
    const labels = [IOL, COCOS].map((account) => {
      const page = movementsPage(
        moved,
        { holdingId: apple(moved, account, PRINCIPAL)!.holding.id },
        "ars",
        null,
      );
      if (!page.ok) throw new Error("page failed");
      return lineLabel(
        page.rows.find((row) => row.movement.operation_id === TRANSFER)!,
      );
    });
    expect(labels).toEqual([
      "Traspaso a Cocos · Principal",
      "Traspaso desde IOL · Principal",
    ]);
  });

  it("can be edited, and keeps the account the units leave", () => {
    const edited = writeOperation(moved, across("1"), {
      ...options(),
      replacing: true,
    });
    expect(edited.result).toEqual({ ok: true, id: TRANSFER });
    expect(apple(edited.state, COCOS, PRINCIPAL)!.holding.amount).toBe("1");
  });
});

it("moves into another portfolio of the other account", () => {
  const moved = written(across("2", { portfolio: LARGO }));
  expect(apple(moved, COCOS, LARGO)!.holding.amount).toBe("2");
});

it("is refused into an account the user does not have", () => {
  const write = writeOperation(
    state,
    across("2", { to: "e7000000-0000-4000-8000-000000000001" }),
    options("e5000000-0000-4000-8000-000000000002"),
  );
  expect(write.result).toEqual({ ok: false, code: "not_found" });
  expect(write.state).toBe(state);
});

describe("the operation's parts", () => {
  it("take one portfolio once in each account", () => {
    expect(operationInputSchema.safeParse(across("2")).success).toBe(true);
    expect(
      operationInputSchema.safeParse(across("2", { to: IOL })).success,
    ).toBe(false);
  });
});
