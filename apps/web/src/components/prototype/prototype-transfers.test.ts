import { type Denominator, referenceUnit } from "@plant/core";
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
  updateHolding,
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
    expect(bought.state.revisions.get(largo)).toBe(
      moved.revisions.get(largo)! + 1,
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

describe("the tables a transfer reloads", () => {
  const moved = written(transfer("2"));
  const largo = appleIn(moved, LARGO)!.holding.id;

  it("reloads the side left when the other moves to another portfolio", () => {
    const edited = writeOperation(moved, transfer("2", { to: CORTO }), {
      ...options(),
      replacing: true,
    }).state;
    expect(edited.revisions.get(AAPL)).toBeGreaterThan(
      moved.revisions.get(AAPL)!,
    );
  });

  it("reloads the other side when a holding moves to another portfolio", () => {
    const stored = appleIn(moved, PRINCIPAL)!;
    const update = updateHolding(moved, AAPL, {
      asset_class: "instrument",
      amount: stored.holding.amount,
      currency: null,
      annual_rate: null,
      started_on: null,
      matures_on: null,
      valued_on: null,
      label: null,
      portfolio_id: CORTO,
    });
    expect(update.result).toEqual({ ok: true, id: AAPL });
    expect(update.state.revisions.get(largo)).toBe(
      moved.revisions.get(largo)! + 1,
    );
  });
});

it("costs a sale of the units that arrived at the cost they carried", () => {
  const moved = written(transfer("2"));
  const arrived = positionIn(moved, LARGO)!.money!.cost;
  const sold = writeOperation(
    moved,
    {
      ...purchase("2", "20000", TODAY),
      kind: "sale",
      parts: [{ portfolio_id: LARGO, quantity: "2" }],
    },
    options("e3000000-0000-4000-8000-000000000006"),
  ).state;
  const largo = appleIn(sold, LARGO)!.holding.id;
  expect(stepsOf(sold, largo, "ars").at(-1)!.sale!.cost).toBe(arrived);
});

it("refuses a new operation with an id another operation has", () => {
  const moved = written(transfer("2"));
  expect(
    writeOperation(moved, purchase("1", "1", TODAY), options(TRANSFER)),
  ).toEqual({ state: moved, result: { ok: false, code: "invalid" } });
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

  it("refuses an archived account", () => {
    const iol = state.accounts.find(({ id }) => id === IOL)!;
    const archived = {
      ...state,
      accounts: state.accounts.filter(({ id }) => id !== IOL),
      archivedAccounts: [iol],
    };
    expect(writeOperation(archived, transfer("2"), options())).toEqual({
      state: archived,
      result: { ok: false, code: "source_connection_archived" },
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
      result: { ok: false, code: "portfolio_archived" },
    });
  });
});

describe("the cost a transfer suggests", () => {
  // What its units carried into the portfolio they went to, per unit.
  const carried = (
    s: PrototypeState,
    to: string,
    unit: Denominator = "ars",
  ) => {
    const holding = appleIn(s, to)!.holding.id;
    const own = s.movements.get(holding)!;
    const index = own.findIndex((each) => each.operation_id === TRANSFER);
    const steps = stepsOf(s, holding, unit);
    const before = index === 0 ? null : steps[index - 1]!.position.money!;
    const cost = exactOf(steps[index]!.position.money!.cost);
    return stored(
      over(
        before ? plus(cost, exactOf(`-${before.cost}`)) : cost,
        exactOf((own[index] as { quantity: string }).quantity),
      ),
    );
  };
  const suggested = (
    s: PrototypeState,
    input: ReturnType<typeof transfer>,
    editing = false,
  ) =>
    suggestedTransferCost(s, {
      input,
      operationId: editing ? TRANSFER : null,
    });
  const edited = (s: PrototypeState, input: ReturnType<typeof transfer>) => {
    const write = writeOperation(s, input, { ...options(), replacing: true });
    expect(write.result.ok).toBe(true);
    return write.state;
  };

  it("is the cost the units carry once written", () => {
    const input = transfer("2");
    expect(suggested(state, input)).toBe(carried(written(input), LARGO));
  });

  it("is what an edit carries, the transfer it replaces left out", () => {
    const moved = written(transfer("2"));
    const later = writeOperation(
      moved,
      purchase("10", "1", TODAY),
      options("e3000000-0000-4000-8000-000000000008"),
    ).state;
    const input = transfer("3");
    expect(suggested(later, input, true)).toBe(
      carried(edited(later, input), LARGO),
    );
    expect(suggested(later, input, true)).toBe(suggested(state, input));
  });

  it("is what an edit moved to a later day carries, where the write puts it", () => {
    const moved = written(transfer("2", { date: "2026-10-01" }));
    const bought = writeOperation(
      moved,
      purchase("10", "1", "2026-10-05"),
      options("e3000000-0000-4000-8000-000000000009"),
    ).state;
    const input = transfer("2", { date: "2026-10-05" });
    expect(suggested(bought, input, true)).toBe(
      carried(edited(bought, input), LARGO),
    );
  });

  it("is what an edit carries when it keeps its place on a later day", () => {
    const moved = written(transfer("2", { date: "2026-10-01" }));
    const sold = writeOperation(
      moved,
      {
        ...purchase("2", "1", "2026-10-05"),
        kind: "sale",
        parts: [{ portfolio_id: LARGO, quantity: "2" }],
      },
      options("e3000000-0000-4000-8000-000000000004"),
    ).state;
    const input = transfer("2", { date: "2026-10-05" });
    expect(suggested(sold, input, true)).toBe(
      carried(edited(sold, input), LARGO),
    );
  });

  it("is in the dollar the user values in for a dollar cost", () => {
    const input = { ...transfer("2"), currency: "USD" };
    expect(suggested(state, input)).toBe(
      carried(written(input), LARGO, referenceUnit(state.referenceDollar)),
    );
  });

  it("has none until the transfer can be written", () => {
    expect(
      suggested(state, {
        ...transfer("2"),
        parts: [
          transfer("2").parts[0]!,
          { ...transfer("2").parts[1]!, portfolio_id: "" },
        ],
      }),
    ).toBeNull();
    expect(suggested(state, transfer("100000"))).toBeNull();
  });

  it("ignores the cost typed, even one that does not parse", () => {
    expect(suggested(state, transfer("2", { price: "abc" }))).toBe(
      suggested(state, transfer("2")),
    );
    const input = transfer("2");
    expect(
      suggested(state, {
        ...input,
        parts: [{ ...input.parts[0]!, price: "10" }, input.parts[1]!],
      }),
    ).toBe(suggested(state, input));
  });

  it("has none for an edit that cannot be written", () => {
    const moved = written(transfer("2"));
    expect(suggested(moved, transfer("100000"), true)).toBeNull();
  });

  it("changes nothing, nor the steps the real state keeps", () => {
    // Corto's holding, the newest, leads the group and is one a transfer to
    // Largo leaves alone.
    const moved = writeOperation(
      written(transfer("2")),
      transfer("1", { to: CORTO }),
      options("e3000000-0000-4000-8000-000000000010"),
    ).state;
    const snapshot = structuredClone(moved);
    const steps = stepsOf(moved, AAPL, "ars");
    suggested(moved, transfer("3"), true);
    suggested(moved, transfer("1"));
    expect(moved).toEqual(snapshot);
    expect(stepsOf(moved, AAPL, "ars")).toBe(steps);
  });
});
