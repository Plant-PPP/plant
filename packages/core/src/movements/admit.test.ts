import {
  admitMovement,
  admitMovements,
  isOrderRefusal,
  quantityOn,
} from "./admit";
import {
  adjustment,
  income,
  ratesOf,
  trade,
  yielded,
} from "./fixtures.test-support";

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

  it("starts a holding with units coming in, never with a sale or income", () => {
    expect(
      admitMovement({ prior: null, after: [] }, purchase, { today: TODAY }),
    ).toEqual({ ok: true, quantity: "5" });
    expect(
      admitMovement({ prior: null, after: [] }, sale, { today: TODAY }),
    ).toEqual({ ok: false, code: "opening_balance" });
    expect(
      admitMovement(
        { prior: null, after: [] },
        income("dividend", "1", { date: "2026-01-01" }),
        { today: TODAY },
      ),
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

  it("needs the euro's rate only for a movement in euros", () => {
    const inEuros = {
      ...income("dividend", "3", { date: "2026-03-01", currency: "EUR" }),
    };
    expect(admitMovement(history, inEuros, { today: TODAY })).toEqual({
      ok: false,
      code: "no_rate",
      missing: ["eur"],
    });
    const rated = {
      ...inEuros,
      rates: {
        ...inEuros.rates,
        eur: { sell: "1300", date: "2026-03-01" },
      },
    };
    expect(admitMovement(history, rated, { today: TODAY })).toMatchObject({
      ok: true,
    });
    const inPesos = income("dividend", "3", { date: "2026-03-01" });
    expect(admitMovement(history, inPesos, { today: TODAY })).toMatchObject({
      ok: true,
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

it("counts an adjustment out like a sale", () => {
  const out = adjustment("out", "16", { date: "2026-03-01" });
  expect(
    admitMovement({ prior: null, after: [opening, purchase] }, out, {
      today: TODAY,
    }),
  ).toEqual({ ok: false, code: "oversold" });
});

describe("admitMovements", () => {
  it("refuses a removal that leaves a later sale overselling", () => {
    expect(admitMovements({ prior: null, after: [opening, sale] })).toEqual({
      ok: false,
      code: "oversold",
    });
  });

  it("refuses removing what started the holding before a sale", () => {
    expect(admitMovements({ prior: null, after: [sale] })).toEqual({
      ok: false,
      code: "opening_balance",
    });
  });

  it("admits a sale of what was bought earlier the same day", () => {
    const bought = trade("purchase", "10", "100", { date: "2026-03-02" });
    const sold = trade("sale", "10", "101", { date: "2026-03-02" });
    expect(admitMovements({ prior: null, after: [sold, bought] })).toEqual({
      ok: true,
      quantity: "0",
    });
  });

  it("refuses a sale entered before that day's purchase with nothing held", () => {
    const sold = trade("sale", "10", "101", { date: "2026-03-02" });
    const bought = trade("purchase", "10", "100", { date: "2026-03-02" });
    expect(admitMovements({ prior: null, after: [bought, sold] })).toEqual({
      ok: false,
      code: "opening_balance",
    });
  });

  it("adds a yield's units to a holding and never starts one with it", () => {
    const earned = yielded("in", "2", "110", { date: "2026-02-10" });
    expect(admitMovements({ prior: null, after: [purchase, earned] })).toEqual({
      ok: true,
      quantity: "7",
    });
    expect(admitMovements({ prior: null, after: [earned] })).toEqual({
      ok: false,
      code: "opening_balance",
    });
  });

  it("refuses a yield that loses more units than are held", () => {
    const lost = yielded("out", "6", "110", { date: "2026-02-10" });
    expect(admitMovements({ prior: null, after: [purchase, lost] })).toEqual({
      ok: false,
      code: "oversold",
    });
  });

  it("lets a yield take out every unit held, and another reopen the holding", () => {
    const lost = yielded("out", "5", "110", { date: "2026-02-10" });
    const earned = yielded("in", "1", "110", { date: "2026-02-11" });
    expect(admitMovements({ prior: null, after: [purchase, lost] })).toEqual({
      ok: true,
      quantity: "0",
    });
    expect(
      admitMovements({ prior: null, after: [purchase, lost, earned] }),
    ).toEqual({ ok: true, quantity: "1" });
  });

  it("admits an empty history", () => {
    expect(admitMovements({ prior: null, after: [] })).toEqual({
      ok: true,
      quantity: "0",
    });
  });
});

it("names the refusals that depend on the order within a day", () => {
  expect(
    ["oversold", "opening_balance", "future_date", "no_rate"].filter(
      isOrderRefusal,
    ),
  ).toEqual(["oversold", "opening_balance"]);
});

describe("quantityOn", () => {
  const earned = yielded("in", "2", "110", { date: "2026-02-02" });
  const history = [opening, purchase, earned, sale];

  it("counts the units held at the end of a date, that day included", () => {
    expect(quantityOn(history, "2026-02-01")).toBe("10");
    expect(quantityOn(history, "2026-02-02")).toBe("17");
    expect(quantityOn(history, "2026-03-02")).toBe("5");
  });

  it("counts nothing for income or no movements", () => {
    const dividend = income("dividend", "1", { date: "2026-03-05" });
    expect(quantityOn([...history, dividend], "2026-03-05")).toBe("5");
    expect(quantityOn([], "2026-03-05")).toBe("0");
  });
});
