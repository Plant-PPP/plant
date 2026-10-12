import { exactOf, over, plus, stored } from "@plant/shared";

import { buildFixtures } from "@/lib/prototype/fixtures";

import { archivePortfolio, createPortfolio } from "./prototype-accounts-store";
import {
  deleteHolding,
  deleteOperation,
  groupOf,
  holdingIn,
  initialState,
  type PrototypeState,
  stepsOf,
  suggestedTransferCost,
  writeOperation,
} from "./prototype-store";

const TODAY = "2026-10-12";
const fixtures = buildFixtures(TODAY);
const state = initialState(fixtures, TODAY);

const IOL = fixtures.accounts.find((row) => row.institution === "IOL")!.id;
const [PRINCIPAL, LARGO, CORTO] = fixtures.portfolios.map((row) => row.id) as [
  string,
  string,
  string,
];
const AAPL = holdingIn(state, IOL, "AAPL", PRINCIPAL)!.holding.id;
const TRANSFER = "e3000000-0000-4000-8000-000000000001";
let ids = 0;
const options = (operationId = TRANSFER) => ({
  operationId,
  newId: () =>
    `e4000000-0000-4000-8000-${String((ids += 1)).padStart(12, "0")}`,
});

// Apple, held in IOL's Principal, moved to another portfolio.
const transfer = (
  quantity: string,
  {
    to = LARGO,
    date = TODAY,
    price = null,
  }: { to?: string; date?: string; price?: string | null } = {},
) => ({
  kind: "transfer",
  source_connection_id: IOL,
  instrument_symbol: "AAPL",
  date,
  currency: "ARS",
  reference: null,
  note: null,
  parts: [
    { portfolio_id: PRINCIPAL, direction: "out", quantity },
    { portfolio_id: to, direction: "in", quantity, price },
  ],
});

const purchase = (quantity: string, price: string, date: string) => ({
  kind: "purchase",
  source_connection_id: IOL,
  instrument_symbol: "AAPL",
  date,
  currency: "ARS",
  price,
  parts: [{ portfolio_id: PRINCIPAL, quantity }],
});

const appleIn = (s: PrototypeState, portfolio: string) =>
  holdingIn(s, IOL, "AAPL", portfolio);
const positionIn = (s: PrototypeState, portfolio: string) => {
  const holding = appleIn(s, portfolio);
  return holding
    ? stepsOf(s, holding.holding.id, "ars").at(-1)!.position
    : null;
};
const written = (input: unknown, from = state) => {
  const write = writeOperation(from, input, options());
  expect(write.result).toEqual({ ok: true, id: TRANSFER });
  return write.state;
};

describe("a transfer between portfolios", () => {
  const before = positionIn(state, PRINCIPAL)!;
  const moved = written(transfer("2"));

  it("moves the units with the cost they had, and makes no result", () => {
    const left = positionIn(moved, PRINCIPAL)!;
    const arrived = positionIn(moved, LARGO)!;
    expect(arrived.quantity).toBe("2");
    expect(exactOf(left.quantity)).toEqual(
      plus(exactOf(before.quantity), exactOf("-2")),
    );
    expect(
      stored(plus(exactOf(left.money!.cost), exactOf(arrived.money!.cost))),
    ).toBe(before.money!.cost);
    const share = (Number(before.money!.cost) * 2) / Number(before.quantity);
    expect(Number(arrived.money!.cost)).toBeCloseTo(share, 4);
    expect(left.money!.realized).toBe(before.money!.realized);
    expect(arrived.money!.realized).toBe("0");
  });

  it("creates the holding it arrives in with the quantity", () => {
    expect(appleIn(state, LARGO)).toBeUndefined();
    expect(appleIn(moved, LARGO)!.holding.amount).toBe("2");
  });

  it("puts both holdings in one group", () => {
    const largo = appleIn(moved, LARGO)!.holding.id;
    expect(groupOf(moved, AAPL)).toContain(largo);
    expect(groupOf(moved, largo)).toEqual(groupOf(moved, AAPL));
  });

  it("carries a manual cost per unit when it names one", () => {
    const manual = written(transfer("2", { price: "100" }));
    expect(positionIn(manual, LARGO)!.money!.cost).toBe("200");
    expect(positionIn(manual, PRINCIPAL)).toEqual(positionIn(moved, PRINCIPAL));
  });

  it("follows an earlier purchase in the portfolio it left", () => {
    const largo = appleIn(moved, LARGO)!.holding.id;
    const bought = writeOperation(
      moved,
      purchase("10", "1", "2026-01-02"),
      options("e3000000-0000-4000-8000-000000000002"),
    );
    expect(bought.result.ok).toBe(true);
    expect(bought.state.revisions.get(largo)).toBeGreaterThan(
      moved.revisions.get(largo)!,
    );
    expect(positionIn(bought.state, LARGO)!.money!.cost).not.toBe(
      positionIn(moved, LARGO)!.money!.cost,
    );
  });

  it("edits the quantity and the date", () => {
    const edited = writeOperation(
      moved,
      transfer("3", { date: "2026-10-09" }),
      {
        ...options(),
        replacing: true,
      },
    );
    expect(edited.result.ok).toBe(true);
    expect(appleIn(edited.state, LARGO)!.holding.amount).toBe("3");
    expect(
      edited.state.movements
        .get(appleIn(edited.state, LARGO)!.holding.id)!
        .map(({ date }) => date),
    ).toEqual(["2026-10-09"]);
  });

  it("moves to another portfolio, removing the one it left empty", () => {
    const edited = writeOperation(moved, transfer("2", { to: CORTO }), {
      ...options(),
      replacing: true,
    });
    expect(edited.result.ok).toBe(true);
    expect(appleIn(edited.state, LARGO)).toBeUndefined();
    expect(appleIn(edited.state, CORTO)!.holding.amount).toBe("2");
    expect(positionIn(edited.state, PRINCIPAL)).toEqual(
      positionIn(moved, PRINCIPAL),
    );
  });

  it("is deleted with both its sides", () => {
    const deleted = deleteOperation(moved, TRANSFER);
    expect(deleted.result).toEqual({ ok: true, id: TRANSFER });
    expect(appleIn(deleted.state, LARGO)).toBeUndefined();
    expect(positionIn(deleted.state, PRINCIPAL)).toEqual(before);
  });

  it("keeps either holding from being deleted while it is there", () => {
    for (const holding of [AAPL, appleIn(moved, LARGO)!.holding.id]) {
      expect(deleteHolding(moved, holding)).toEqual({
        state: moved,
        result: { ok: false, code: "holding_has_transfers" },
      });
    }
    const without = deleteOperation(moved, TRANSFER).state;
    expect(deleteHolding(without, AAPL).result).toEqual({ ok: true, id: AAPL });
  });
});

describe("a refused transfer", () => {
  it.each([
    ["oversold", transfer("100000")],
    [
      "invalid",
      {
        ...transfer("2"),
        parts: [
          transfer("2").parts[0],
          { ...transfer("2").parts[1], quantity: "3" },
        ],
      },
    ],
    ["invalid", transfer("2", { to: PRINCIPAL })],
    [
      "invalid",
      {
        ...transfer("2"),
        parts: [
          transfer("2").parts[0],
          { ...transfer("2").parts[0], portfolio_id: LARGO },
        ],
      },
    ],
    [
      "invalid",
      {
        ...transfer("2"),
        parts: [
          { ...transfer("2").parts[0], price: "10" },
          transfer("2").parts[1],
        ],
      },
    ],
    ["invalid", { ...transfer("2"), charges: [] }],
  ])("refuses with %s and changes nothing", (code, input) => {
    expect(writeOperation(state, input, options())).toEqual({
      state,
      result: { ok: false, code },
    });
  });

  it("refuses an archived portfolio", () => {
    const TEMP = "e3000000-0000-4000-8000-000000000009";
    const created = createPortfolio(state, { name: "Temporal" }, TEMP).state;
    const archived = archivePortfolio(created, TEMP);
    expect(archived.result.ok).toBe(true);
    expect(
      writeOperation(archived.state, transfer("2", { to: TEMP }), options()),
    ).toEqual({
      state: archived.state,
      result: { ok: false, code: "archived_portfolio" },
    });
  });
});

describe("the cost a transfer suggests", () => {
  const query = {
    accountId: IOL,
    instrument: "AAPL",
    portfolioId: PRINCIPAL,
    currency: "ARS" as const,
    date: TODAY,
    operationId: null,
  };
  const averageIn = (s: PrototypeState) => {
    const { quantity, money } = positionIn(s, PRINCIPAL)!;
    return stored(over(exactOf(money!.cost), exactOf(quantity)));
  };

  it("is the average cost the units have before it", () => {
    expect(suggestedTransferCost(state, query)).toBe(averageIn(state));
  });

  it("leaves out the transfer an edit replaces", () => {
    const moved = written(transfer("2"));
    expect(
      suggestedTransferCost(moved, { ...query, operationId: TRANSFER }),
    ).toBe(averageIn(state));
  });

  it("leaves out what comes after its day", () => {
    const later = writeOperation(
      state,
      purchase("10", "1", TODAY),
      options("e3000000-0000-4000-8000-000000000003"),
    ).state;
    expect(suggestedTransferCost(later, { ...query, date: "2026-10-11" })).toBe(
      averageIn(state),
    );
  });

  it("is in the dollar the user values in for a dollar cost", () => {
    const dollars = suggestedTransferCost(state, {
      ...query,
      currency: "USD",
    });
    expect(dollars).not.toBeNull();
    expect(Number(dollars)).toBeLessThan(Number(averageIn(state)));
  });

  it("has none where nothing is held", () => {
    expect(
      suggestedTransferCost(state, { ...query, portfolioId: LARGO }),
    ).toBeNull();
  });
});
