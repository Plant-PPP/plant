import { compareDecimals } from "@plant/shared";

import { readTotals, totalsMatch } from "@/lib/imports/review";
import { buildFixtures } from "@/lib/prototype/fixtures";

import {
  addImport,
  confirmImport,
  finishReading,
  heldIn,
} from "./prototype-imports-store";
import { holdingsView, initialState, writeOperation } from "./prototype-store";

const TODAY = "2026-10-12";
const state = initialState(buildFixtures(TODAY), TODAY);
const IOL = state.accounts.find((row) => row.institution === "IOL")!.id;
let ids = 0;
const newId = () =>
  `e7000000-0000-4000-8000-${String((ids += 1)).padStart(12, "0")}`;

const read = (fileName: string) =>
  finishReading(
    addImport(state, { id: "i1", fileName, accountId: IOL }).state,
    "i1",
  );

it("refuses a file it cannot read, with the reason", () => {
  const item = read("notas.txt").imports[0]!;
  expect(item.status).toBe("failed");
  expect(item.error).toMatch(/tipo de archivo/);
});

it("reads a statement whose misread row does not add up", () => {
  const item = read("resumen.pdf").imports[0]!;
  expect(item.status).toBe("ready");
  expect(item.rows.some((row) => row.confidence === "low")).toBe(true);
  expect(totalsMatch(readTotals(item.rows), item.documentTotals)).toBe(false);
});

it("leaves the account as the reviewed rows say", () => {
  const after = read("resumen.pdf");
  const item = after.imports[0]!;
  // The user fixes the misread row and drops the new instrument.
  const truth = item.rows.map((row) =>
    row.confidence === "low"
      ? {
          ...row,
          quantity: String(Number(row.quantity) * 10),
          confidence: "high" as const,
        }
      : row.id.endsWith("-new")
        ? { ...row, discarded: true }
        : row,
  );
  const confirmed = confirmImport(after, "i1", truth, newId);
  expect(confirmed.result).toEqual({ ok: true, id: "i1" });
  expect(confirmed.state.imports[0]!.status).toBe("confirmed");
  for (const row of truth.filter((each) => !each.discarded)) {
    const held = holdingsView(confirmed.state)
      .active.filter(
        (each) =>
          each.account.id === IOL &&
          each.holding.asset_class === "instrument" &&
          each.holding.instrument_symbol === row.symbol,
      )
      .map((each) => each.holding.amount);
    expect(held.length).toBeGreaterThan(0);
    expect(
      compareDecimals(
        held.reduce((a, b) => String(Number(a) + Number(b))),
        row.quantity,
      ),
    ).toBe(0);
  }
});

it("takes a decrease out of every portfolio that holds it, largest first", () => {
  const binance = state.accounts.find((row) => row.institution === "Binance")!;
  const read = finishReading(
    addImport(state, {
      id: "i2",
      fileName: "binance.png",
      accountId: binance.id,
    }).state,
    "i2",
  );
  const rows = read.imports[0]!.rows.map((row) =>
    row.symbol === "ETH"
      ? { ...row, quantity: "0.2", confidence: "high" as const }
      : { ...row, discarded: true },
  );
  const confirmed = confirmImport(read, "i2", rows, newId);
  expect(confirmed.result).toEqual({ ok: true, id: "i2" });
  const eth = holdingsView(confirmed.state).active.filter(
    (each) =>
      each.account.id === binance.id &&
      each.holding.asset_class === "instrument" &&
      each.holding.instrument_symbol === "ETH",
  );
  expect(eth.map((each) => each.holding.amount)).toEqual(["0.2"]);
});

it("prices what the feeds do not price from the user's manual price", () => {
  const cocos = state.accounts.find((row) => row.institution === "Cocos")!;
  const read = finishReading(
    addImport(state, {
      id: "i3",
      fileName: "cocos.pdf",
      accountId: cocos.id,
    }).state,
    "i3",
  );
  const ko = read.imports[0]!.rows.find((row) => row.symbol === "KO")!;
  expect(ko.price).not.toBeNull();
  expect(ko.currency).toBe("ARS");
});

it("refuses an instrument listed twice, changing nothing", () => {
  const after = read("resumen.pdf");
  const [first] = after.imports[0]!.rows;
  const twice = [first!, { ...first!, id: "again" }];
  const refused = confirmImport(after, "i1", twice, newId);
  expect(refused.result).toEqual({ ok: false, code: "invalid" });
  expect(refused.state).toBe(after);
});

it("refuses units that come in at no price", () => {
  const after = read("resumen.pdf");
  const rows = after.imports[0]!.rows.map((row) =>
    row.id.endsWith("-new") ? { ...row, price: "0" } : row,
  );
  expect(confirmImport(after, "i1", rows, newId).result).toEqual({
    ok: false,
    code: "invalid",
  });
});

it("adjusts an instrument the portfolio sold out of back in", () => {
  const cocos = state.accounts.find((row) => row.institution === "Cocos")!;
  const sold = state.holdings.find(
    (each) =>
      each.closed &&
      each.accountId === cocos.id &&
      each.portfolioId === cocos.portfolio.id,
  )!;
  expect(sold.holding.asset_class).toBe("instrument");
  const symbol =
    sold.holding.asset_class === "instrument"
      ? sold.holding.instrument_symbol
      : "";
  const after = finishReading(
    addImport(state, { id: "i3", fileName: "cocos.pdf", accountId: cocos.id })
      .state,
    "i3",
  );
  const confirmed = confirmImport(
    after,
    "i3",
    [
      {
        id: "back",
        symbol,
        quantity: "2",
        price: "100",
        currency: state.instruments.find((each) => each.symbol === symbol)!
          .currency,
        confidence: "high",
        source: "Página 1",
        discarded: false,
      },
    ],
    newId,
  );
  expect(confirmed.result).toEqual({ ok: true, id: "i3" });
  const own = confirmed.state.movements.get(sold.holding.id)!;
  expect(own.at(-1)!.kind).toBe("adjustment");
  expect(
    holdingsView(confirmed.state).active.find(
      (row) => row.id === sold.holding.id,
    )?.holding.amount,
  ).toBe("2");
});

it("refuses a kept row with no units, changing nothing", () => {
  const after = read("resumen.pdf");
  const rows = after.imports[0]!.rows.map((row, index) =>
    index === 0 ? { ...row, quantity: "0" } : row,
  );
  const refused = confirmImport(after, "i1", rows, newId);
  expect(refused.result).toEqual({ ok: false, code: "invalid" });
  expect(refused.state).toBe(after);
});

it("weighs a past statement against what was held on its date", () => {
  const iol = state.accounts.find((each) => each.institution === "IOL")!;
  // 2 AAPL sold after the statement's date.
  const sold = writeOperation(
    state,
    {
      kind: "sale",
      source_connection_id: iol.id,
      instrument_symbol: "AAPL",
      date: "2026-10-05",
      currency: "ARS",
      price: "20000",
      charges: [],
      reference: null,
      note: null,
      parts: [{ portfolio_id: iol.portfolio.id, quantity: "2" }],
    },
    { operationId: "sold", newId },
  ).state;
  const read = finishReading(
    addImport(sold, { id: "i9", fileName: "septiembre.pdf", accountId: IOL })
      .state,
    "i9",
  );
  const onTheFirst = heldIn(read, IOL, "2026-10-01");
  const dated = {
    ...read,
    imports: read.imports.map((each) =>
      each.id === "i9" ? { ...each, documentDate: "2026-10-01" } : each,
    ),
  };
  // The statement lists AAPL exactly as held on its date.
  const rows = [
    {
      id: "aapl",
      symbol: "AAPL",
      quantity: onTheFirst.get("AAPL")!,
      price: "20000",
      currency: "ARS" as const,
      confidence: "high" as const,
      source: "Página 1",
      discarded: false,
    },
  ];
  const confirmed = confirmImport(dated, "i9", rows, newId);
  expect(confirmed.result.ok).toBe(true);
  expect(heldIn(confirmed.state, IOL).get("AAPL")).toBe(
    heldIn(sold, IOL).get("AAPL"),
  );
});
