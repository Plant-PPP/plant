import { buildFixtures } from "@/lib/prototype/fixtures";

import { prototypeMovementsInput } from "./prototype-movements";
import { deleteHolding, initialState, movementsPage } from "./prototype-store";

const TODAY = "2026-10-12";
const fixtures = buildFixtures(TODAY);
const state = initialState(fixtures, TODAY);
const AAPL = fixtures.holdings.find(
  (row) =>
    row.holding.asset_class === "instrument" &&
    row.holding.instrument_symbol === "AAPL",
)!.id;

describe("prototypeMovementsInput", () => {
  it("reads the store as it is when the page asks", async () => {
    let current = state;
    const input = prototypeMovementsInput(() => current);
    const scope = { holdingId: AAPL };
    const before = movementsPage(state, scope, "ars", null);
    if (!before.ok) throw new Error("page failed");
    expect(before.rows.length).toBeGreaterThan(0);

    current = deleteHolding(state, AAPL).state;

    expect(await input.loadMovements(scope, "ars", null)).toEqual(
      movementsPage(current, scope, "ars", null),
    );
    expect(await input.loadMovements(scope, "ars", null)).not.toEqual(before);
  });
});
