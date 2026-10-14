import { emptyLedger } from "@/lib/ledger/ledger-fixture.test-support";
import * as oracle from "@/lib/summary/closes-oracle.test-support";

import { type ClosesState, pricedToday } from "./compute";

describe("a feed rate older than QUOTE_CARRY_DAYS", () => {
  const state: ClosesState = {
    ...emptyLedger(),
    liabilities: [],
    recalculated: new Map(),
    quotes: {
      fxRates: [{ kind: "mep", rate_date: "2026-10-01", sell: "1300" }],
      prices: [],
    },
    manualRates: [{ kind: "mep", rate_date: "2026-06-01", sell: "900" }],
  };

  it("holds back an older manual rate on a close's day", () => {
    expect(pricedToday(state).fx.mep).toBeUndefined();
    expect(oracle.pricedToday(state).fx.mep).toBeUndefined();
  });

  it("gives way to a manual rate newer than it", () => {
    const newer: ClosesState = {
      ...state,
      manualRates: [{ kind: "mep", rate_date: "2026-10-05", sell: "1350" }],
    };
    expect(pricedToday(newer).fx.mep).toEqual({
      sell: "1350",
      date: "2026-10-05",
    });
  });
});
