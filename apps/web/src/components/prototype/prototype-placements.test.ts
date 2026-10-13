import { placementFigures } from "@plant/core";

import { initialFields, toUpdate } from "@/components/holdings/holding-fields";
import { buildFixtures } from "@/lib/prototype/fixtures";

import {
  allRows,
  holdingsView,
  initialState,
  renewPlacement,
  setPlacement,
  updateHoldingDetails,
} from "./prototype-store";

const TODAY = "2026-10-12";
const fixtures = buildFixtures(TODAY);
const state = initialState(fixtures, TODAY);

const CAUCION = "c2000000-0000-4000-8000-000000000004";
const PLAZO_FIJO = "c2000000-0000-4000-8000-000000000005";
const CASH = "c2000000-0000-4000-8000-000000000001";
const RENEWAL = "c3000000-0000-4000-8000-000000000001";

const placement = (s: typeof state, id: string) => {
  const row = allRows(s).find((each) => each.id === id)!;
  if (row.holding.asset_class !== "fixed_term") throw new Error("not one");
  return row.holding;
};
const term = (startedOn: string, maturesOn: string, rate = "0.3") => ({
  started_on: startedOn,
  matures_on: maturesOn,
  annual_rate: rate,
});

describe("a placement's kind", () => {
  it("starts as the fixtures say: a caución, and a plazo fijo by default", () => {
    expect(state.placements.get(CAUCION)).toBe("caucion");
    expect(state.placements.has(PLAZO_FIJO)).toBe(false);
  });

  it("is set on a placement at a rate only, and a plazo fijo keeps none", () => {
    const loan = setPlacement(state, PLAZO_FIJO, "loan");
    expect(loan.state.placements.get(PLAZO_FIJO)).toBe("loan");
    const back = setPlacement(loan.state, PLAZO_FIJO, "fixed_term");
    expect(back.state.placements.has(PLAZO_FIJO)).toBe(false);
    expect(setPlacement(state, CASH, "loan").result).toEqual({
      ok: false,
      code: "not_found",
    });
  });

  it("is saved with an edit of the placement", () => {
    const row = allRows(state).find((each) => each.id === PLAZO_FIJO)!;
    const fields = initialFields(row, {
      accountId: "",
      portfolioId: "",
      today: TODAY,
    });
    const saved = updateHoldingDetails(
      state,
      PLAZO_FIJO,
      toUpdate(fields, row.portfolio.id),
      { inTaxReport: true, placement: "other" },
    );
    expect(saved.result).toEqual({ ok: true, id: PLAZO_FIJO });
    expect(saved.state.placements.get(PLAZO_FIJO)).toBe("other");
  });
});

describe("renewing a placement that matured", () => {
  const matured = placement(state, CAUCION);
  const renewed = renewPlacement(
    state,
    CAUCION,
    term(matured.matures_on, "2026-10-19"),
    RENEWAL,
  );

  it("places its capital plus the interest again, on the new term", () => {
    expect(renewed.result).toEqual({ ok: true, id: RENEWAL });
    expect(placement(renewed.state, RENEWAL)).toMatchObject({
      amount: placementFigures(matured, TODAY).maturityAmount,
      currency: matured.currency,
      annual_rate: "0.3",
      started_on: matured.matures_on,
      matures_on: "2026-10-19",
    });
  });

  it("keeps its kind, and remembers the one it renewed", () => {
    expect(renewed.state.placements.get(RENEWAL)).toBe("caucion");
    expect(renewed.state.renewals.get(RENEWAL)).toBe(CAUCION);
  });

  it("takes the matured one off the lists, so the money counts once", () => {
    const active = holdingsView(renewed.state).active.map((row) => row.id);
    expect(active).toContain(RENEWAL);
    expect(active).not.toContain(CAUCION);
  });

  it("is refused before the maturity, or starting before it", () => {
    const running = placement(state, PLAZO_FIJO);
    expect(
      renewPlacement(
        state,
        PLAZO_FIJO,
        term(running.matures_on, "2027-01-01"),
        RENEWAL,
      ).result,
    ).toEqual({ ok: false, code: "invalid" });
    expect(
      renewPlacement(
        state,
        CAUCION,
        term(matured.started_on, "2026-10-19"),
        RENEWAL,
      ).result,
    ).toEqual({ ok: false, code: "invalid" });
  });

  it("is refused once renewed, or for a term that ends before it starts", () => {
    expect(
      renewPlacement(
        renewed.state,
        CAUCION,
        term(matured.matures_on, "2026-10-19"),
        "c3000000-0000-4000-8000-000000000002",
      ).result,
    ).toEqual({ ok: false, code: "not_found" });
    expect(
      renewPlacement(state, CAUCION, term("2026-10-19", "2026-10-12"), RENEWAL)
        .result,
    ).toEqual({ ok: false, code: "invalid" });
  });
});
