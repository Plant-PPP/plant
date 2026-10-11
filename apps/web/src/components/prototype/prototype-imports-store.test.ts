import { compareDecimals } from "@plant/shared";

import { readTotals, totalsMatch } from "@/lib/imports/review";
import { buildFixtures } from "@/lib/prototype/fixtures";

import {
  addImport,
  confirmImport,
  finishReading,
} from "./prototype-imports-store";
import { holdingsView, initialState } from "./prototype-store";

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
