import { heldElsewhere, heldIn } from "@/lib/imports/confirm";
import { buildFixtures } from "@/lib/prototype/fixtures";
import type { ImportRow } from "@/lib/imports/review";

import { addImport, confirmImport } from "./prototype-imports-store";
import {
  holdingIn,
  initialState,
  operationOf,
  type PrototypeState,
} from "./prototype-store";

const TODAY = "2026-10-12";
const fixtures = buildFixtures(TODAY);
const state = initialState(fixtures, TODAY);
const accountId = (institution: string) =>
  fixtures.accounts.find((row) => row.institution === institution)!.id;
const IOL = accountId("IOL");
const COCOS = accountId("Cocos");
const [PRINCIPAL, LARGO, CORTO] = fixtures.portfolios.map((row) => row.id) as [
  string,
  string,
  string,
];
let ids = 0;
const newId = () =>
  `f9900000-0000-4000-8000-${String((ids += 1)).padStart(12, "0")}`;

// A statement of Cocos, read as the given rows.
function readAs(rows: Partial<ImportRow>[]): PrototypeState {
  const added = addImport(state, {
    id: "r1",
    fileName: "cocos.pdf",
    accountId: COCOS,
  }).state;
  return {
    ...added,
    imports: added.imports.map((item) =>
      item.id === "r1"
        ? {
            ...item,
            status: "ready",
            documentDate: TODAY,
            rows: rows.map((row, index) => ({
              id: `row-${index}`,
              symbol: "",
              quantity: "1",
              price: null,
              currency: "ARS",
              confidence: "high",
              source: "Página 1",
              discarded: false,
              ...row,
            })),
          }
        : item,
    ),
  };
}
const confirmed = (read: PrototypeState) =>
  confirmImport(read, "r1", read.imports[0]!.rows, newId);

it("lists each instrument the user holds in other accounts", () => {
  const elsewhere = heldElsewhere(state, COCOS);
  expect(elsewhere.get("AAPL")).toEqual([{ id: IOL, institution: "IOL" }]);
  expect(
    [...elsewhere.values()].flat().every((each) => each.id !== COCOS),
  ).toBe(true);
});

describe("a statement's new instrument", () => {
  it("goes to the portfolio the review chose", () => {
    expect(heldIn(state, COCOS).has("AAPL")).toBe(false);
    const done = confirmed(
      readAs([
        { symbol: "AAPL", quantity: "3", price: "15000", portfolioId: LARGO },
      ]),
    );
    expect(done.result).toEqual({ ok: true, id: "r1" });
    expect(holdingIn(done.state, COCOS, "AAPL", LARGO)?.holding.amount).toBe(
      "3",
    );
  });

  it("comes from another account as a transfer, with no price", () => {
    const before = holdingIn(state, IOL, "AAPL", PRINCIPAL)!.holding.amount;
    const done = confirmed(
      readAs([
        {
          symbol: "AAPL",
          quantity: "2",
          portfolioId: CORTO,
          transferFrom: IOL,
        },
      ]),
    );
    expect(done.result).toEqual({ ok: true, id: "r1" });
    expect(holdingIn(done.state, COCOS, "AAPL", CORTO)?.holding.amount).toBe(
      "2",
    );
    expect(
      Number(holdingIn(done.state, IOL, "AAPL", PRINCIPAL)!.holding.amount),
    ).toBe(Number(before) - 2);
    const [operationId] = [...done.state.operationOrigins.keys()];
    const operation = operationOf(done.state, operationId!)!;
    expect(operation.accountId).toBe(IOL);
    expect(operation.parts.map((part) => part.movement.kind)).toEqual([
      "transfer",
      "transfer",
    ]);
  });

  it("is refused as a transfer from an account that does not hold it", () => {
    expect(
      confirmed(
        readAs([{ symbol: "AAPL", quantity: "2", transferFrom: COCOS }]),
      ).result,
    ).toEqual({ ok: false, code: "not_found" });
  });
});
