import { writeOperation } from "./ledger";
import {
  ACCOUNT,
  emptyLedger,
  OTHER_PORTFOLIO,
  PORTFOLIO,
  PURCHASE,
} from "./ledger-fixture.test-support";
import { expectedRevisions, operationSymbols, rpcPartsOf } from "./rpc-parts";

const written = writeOperation(emptyLedger(), PURCHASE, {
  operationId: "op",
  newId: () => crypto.randomUUID(),
});

it("sends one part per portfolio, each naming its holding's account, portfolio and instrument", () => {
  expect(written.result.ok).toBe(true);
  const parts = rpcPartsOf(written.state, "op");
  expect(
    parts.map(({ portfolio_id, quantity }) => [portfolio_id, quantity]),
  ).toEqual(
    expect.arrayContaining([
      [PORTFOLIO, "3"],
      [OTHER_PORTFOLIO, "2"],
    ]),
  );
  for (const part of parts) {
    expect(part).toMatchObject({
      source_connection_id: ACCOUNT,
      instrument_symbol: "AAPL",
      kind: "purchase",
      date: "2026-09-15",
      currency: "ARS",
      direction: null,
      price: "18000",
      amount: null,
      charges: [],
    });
    // The dollar rates of the day before, stored with the movement.
    expect(part.rates.mep).toEqual({ sell: "1200", date: "2026-09-14" });
  }
});

it("sends no part once the operation is gone, and names its instruments", () => {
  expect(rpcPartsOf(written.state, "other")).toEqual([]);
  expect(operationSymbols(written.state, "op")).toEqual(new Set(["AAPL"]));
  expect(operationSymbols(emptyLedger(), "op")).toEqual(new Set());
});

it("expects every holding of the instruments, archived ones included", () => {
  expect(
    expectedRevisions(
      new Map([
        ["h1", 3],
        ["h2", 0],
      ]),
      new Map([
        ["h1", "AAPL"],
        ["h2", "AAPL"],
        ["h3", "KO"],
        ["h4", "AAPL"],
      ]),
      new Set(["AAPL"]),
    ),
  ).toEqual({ h1: 3, h2: 0, h4: 0 });
});
