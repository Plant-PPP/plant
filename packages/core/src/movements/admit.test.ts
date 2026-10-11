import { admitMovement, admitMovements } from "./admit";
import { income, ratesOf, trade } from "./fixtures.test-support";

const TODAY = "2026-10-12";
const opening = trade("opening_balance", "10", "100", { date: "2026-01-05" });
const purchase = trade("purchase", "5", "100", { date: "2026-02-02" });
const sale = trade("sale", "12", "120", { date: "2026-03-02" });

describe("admitMovement", () => {
  const history = { prior: null, after: [opening, purchase] };

  it("admits a sale of what is held and gives the quantity left", () => {
    expect(admitMovement(history, sale, { today: TODAY })).toEqual({
      ok: true,
      quantity: "3",
    });
  });

  it("refuses a sale of more than is held", () => {
    const tooMuch = trade("sale", "16", "120", { date: "2026-03-02" });
    expect(admitMovement(history, tooMuch, { today: TODAY })).toEqual({
      ok: false,
      code: "oversold",
    });
  });

  it("refuses a back-dated sale that leaves a later sale overselling", () => {
    const later = { prior: null, after: [opening, purchase, sale] };
    const backDated = trade("sale", "4", "120", { date: "2026-01-20" });
    expect(admitMovement(later, backDated, { today: TODAY })).toEqual({
      ok: false,
      code: "oversold",
    });
  });

  it("refuses a first movement that is not the opening balance", () => {
    expect(
      admitMovement({ prior: null, after: [] }, purchase, { today: TODAY }),
    ).toEqual({ ok: false, code: "opening_balance" });
  });

  it("refuses a second opening balance, or one after a movement", () => {
    const another = trade("opening_balance", "1", "1", { date: "2026-04-01" });
    expect(admitMovement(history, another, { today: TODAY })).toEqual({
      ok: false,
      code: "opening_balance",
    });
    const before = trade("purchase", "1", "1", { date: "2025-12-01" });
    expect(admitMovement(history, before, { today: TODAY })).toEqual({
      ok: false,
      code: "opening_balance",
    });
  });

  it("refuses an opening balance once a prior position exists", () => {
    expect(
      admitMovement(
        { prior: { quantity: "10" }, after: [] },
        trade("opening_balance", "1", "1", { date: "2026-04-01" }),
        { today: TODAY },
      ),
    ).toEqual({ ok: false, code: "opening_balance" });
  });

  it("refuses a date after today", () => {
    const tomorrow = trade("purchase", "1", "1", { date: "2026-10-13" });
    expect(admitMovement(history, tomorrow, { today: TODAY })).toEqual({
      ok: false,
      code: "future_date",
    });
  });

  it("refuses a movement without every unit's rate, naming the missing kinds", () => {
    const { mep } = ratesOf("2026-04-01");
    const unrated = { ...purchase, date: "2026-04-01", rates: { mep } };
    expect(admitMovement(history, unrated, { today: TODAY })).toEqual({
      ok: false,
      code: "no_rate",
      missing: ["ccl", "official"],
    });
  });

  it("reads quantities only, so income never refuses", () => {
    const dividend = income("dividend", "3", { date: "2026-03-01" });
    expect(admitMovement(history, dividend, { today: TODAY })).toEqual({
      ok: true,
      quantity: "15",
    });
  });

  it("re-admits an edit against the history without the movement it replaces", () => {
    const edited = { ...purchase, quantity: "1" };
    const others = { prior: null, after: [opening, sale] };
    expect(admitMovement(others, edited, { today: TODAY })).toEqual({
      ok: false,
      code: "oversold",
    });
    expect(
      admitMovement(others, { ...purchase, quantity: "3" }, { today: TODAY }),
    ).toEqual({ ok: true, quantity: "1" });
  });

  it("resumes from a prior position", () => {
    expect(
      admitMovement({ prior: { quantity: "15" }, after: [] }, sale, {
        today: TODAY,
      }),
    ).toEqual({ ok: true, quantity: "3" });
  });
});

describe("admitMovements", () => {
  it("refuses a removal that leaves a later sale overselling", () => {
    expect(admitMovements({ prior: null, after: [opening, sale] })).toEqual({
      ok: false,
      code: "oversold",
    });
  });

  it("refuses removing the opening balance while movements remain", () => {
    expect(admitMovements({ prior: null, after: [purchase] })).toEqual({
      ok: false,
      code: "opening_balance",
    });
  });

  it("admits an empty history", () => {
    expect(admitMovements({ prior: null, after: [] })).toEqual({
      ok: true,
      quantity: "0",
    });
  });
});
