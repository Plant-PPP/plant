import { isOrderRefusal } from "@plant/core";
import type { Movement } from "@plant/core";

import { WRITE_MESSAGES } from "@/lib/portfolio-setup/messages";

import {
  HOLDING_DELETE_MESSAGES,
  lineLabel,
  MOVEMENT_DELETE_MESSAGES,
  MOVEMENT_MESSAGES,
  movementName,
  SAME_DAY_ORDER,
} from "./messages";

it.each([
  ["dialog", MOVEMENT_MESSAGES],
  ["delete", MOVEMENT_DELETE_MESSAGES],
])(
  "explains same-day order in the %s copy of exactly the refusals that depend on it",
  (_, messages) => {
    for (const [code, message] of Object.entries(messages)) {
      expect([code, message.includes(SAME_DAY_ORDER)]).toEqual([
        code,
        isOrderRefusal(code),
      ]);
    }
  },
);

it("words a refused delete apart from a refused edit", () => {
  for (const code of ["oversold", "opening_balance"] as const) {
    expect(MOVEMENT_DELETE_MESSAGES[code]).toMatch(/^No podés borrarlo: /);
  }
});

describe("a transfer's line", () => {
  const leg = (direction: "in" | "out", holding: string) =>
    ({
      kind: "transfer",
      direction,
      holding_id: holding,
    }) as Movement;
  const out = leg("out", "h1");
  const arrived = leg("in", "h2");
  const operation = {
    accountId: "a1",
    instrument: "BTC",
    parts: [
      {
        movement: out,
        accountId: "a1",
        institution: "IOL",
        portfolioId: "p1",
        portfolioName: "Principal",
      },
      {
        movement: arrived,
        accountId: "a1",
        institution: "IOL",
        portfolioId: "p2",
        portfolioName: "Largo plazo",
      },
    ],
  };

  it("names the portfolio on its other side", () => {
    expect(lineLabel({ movement: out, operation })).toBe(
      "Traspaso a Largo plazo",
    );
    expect(lineLabel({ movement: arrived, operation })).toBe(
      "Traspaso desde Principal",
    );
  });

  it("names the other account too when the units change account", () => {
    const across = {
      ...operation,
      parts: [
        operation.parts[0]!,
        { ...operation.parts[1]!, accountId: "a2", institution: "Binance" },
      ],
    };
    expect(lineLabel({ movement: out, operation: across })).toBe(
      "Traspaso a Binance · Largo plazo",
    );
    expect(lineLabel({ movement: arrived, operation: across })).toBe(
      "Traspaso desde IOL · Principal",
    );
  });

  it("keeps any other movement's label", () => {
    const purchase = { kind: "purchase", holding_id: "h1" } as Movement;
    expect(
      lineLabel({
        movement: purchase,
        operation: {
          ...operation,
          parts: [
            {
              movement: purchase,
              accountId: "a1",
              institution: "IOL",
              portfolioId: "p1",
              portfolioName: "Principal",
            },
          ],
        },
      }),
    ).toBe("Compra");
  });
});

it("asks to delete a holding's transfers first", () => {
  expect(HOLDING_DELETE_MESSAGES.holding_has_transfers).toBe(
    "Tiene traspasos con otra cartera. Borralos primero desde sus movimientos.",
  );
});

it("says an archived account or portfolio needs restoring as the holding dialog does", () => {
  expect(MOVEMENT_MESSAGES.portfolio_archived).toBe(
    "Esa cartera está archivada. Restaurala en Cuentas primero.",
  );
  expect(MOVEMENT_MESSAGES.source_connection_archived).toBe(
    WRITE_MESSAGES.holdings.source_connection_archived,
  );
});

describe("a movement's name in its actions", () => {
  const named = (movement: Partial<Movement>) => {
    const full = {
      holding_id: "h1",
      date: "2026-09-01",
      currency: "USD",
      ...movement,
    } as Movement;
    return movementName({
      movement: full,
      operation: {
        accountId: "a1",
        instrument: "BTC",
        parts: [
          {
            movement: full,
            accountId: "a1",
            institution: "IOL",
            portfolioId: "p1",
            portfolioName: "Principal",
          },
        ],
      },
    });
  };

  it("tells two purchases of one day apart by what they bought", () => {
    const first = named({ kind: "purchase", quantity: "2", price: "10" });
    const second = named({ kind: "purchase", quantity: "0.5", price: "10" });
    expect(first).toBe("compra de 2 del 01/09/2026");
    expect(second).toBe("compra de 0,5 del 01/09/2026");
  });

  it("names income by its amount, in its currency", () => {
    expect(named({ kind: "dividend", amount: "10" })).toBe(
      "dividendo de US$ 10,00 del 01/09/2026",
    );
  });
});

describe("an adjustment's line", () => {
  const adjusted = (direction: "in" | "out", price: string, loan?: string) => {
    const movement = {
      kind: "adjustment",
      direction,
      price,
      holding_id: "h1",
    } as Movement;
    return lineLabel({
      movement,
      operation: {
        accountId: "a1",
        instrument: "BTC",
        ...(loan !== undefined && { loan }),
        parts: [
          {
            movement,
            accountId: "a1",
            institution: "Roxom",
            portfolioId: "p1",
            portfolioName: "Principal",
          },
        ],
      },
    });
  };

  it("reads units in at a cost as a deposit", () => {
    expect(adjusted("in", "84000")).toBe("Depósito");
  });

  it("names the units a loan brought in a loan", () => {
    expect(adjusted("in", "1", "Préstamo Roxom")).toBe("Préstamo");
  });

  it("keeps an adjustment with no cost, or units out, as an adjustment", () => {
    expect(adjusted("in", "0")).toBe("Ajuste (entran)");
    expect(adjusted("out", "0")).toBe("Ajuste (salen)");
  });
});
