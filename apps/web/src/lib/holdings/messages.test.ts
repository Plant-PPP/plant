import { isOrderRefusal } from "@plant/core";
import type { Movement } from "@plant/core";

import { WRITE_MESSAGES } from "@/lib/portfolio-setup/messages";

import {
  HOLDING_DELETE_MESSAGES,
  lineLabel,
  MOVEMENT_DELETE_MESSAGES,
  MOVEMENT_MESSAGES,
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
      { movement: out, portfolioId: "p1", portfolioName: "Principal" },
      { movement: arrived, portfolioId: "p2", portfolioName: "Largo plazo" },
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
