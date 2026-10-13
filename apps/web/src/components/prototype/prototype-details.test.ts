import { snapshotOn } from "@plant/core";

import { readTotals, totalsMatch } from "@/lib/imports/review";
import { buildFixtures } from "@/lib/prototype/fixtures";

import { prototypeAnswer } from "./prototype-assistant";
import { closesOf } from "./prototype-closes";
import { addImport, finishReading } from "./prototype-imports-store";
import {
  createHolding,
  deleteHolding,
  deleteOperation,
  initialState,
  pricedSnapshotOf,
  type PrototypeState,
  setInTaxReport,
  writeOperation,
} from "./prototype-store";

import type { AssetKey } from "@/lib/holdings/assets-rows";

// An asset key as the store writes it.
const asset = (key: string) => key as AssetKey;

const TODAY = "2026-10-12";
const fixtures = buildFixtures(TODAY);
const state = initialState(fixtures, TODAY);
const accountOf = (institution: string) =>
  state.accounts.find((row) => row.institution === institution)!;
const IOL = accountOf("IOL").id;
const COCOS = accountOf("Cocos").id;
const [PRINCIPAL, LARGO, CORTO] = fixtures.portfolios.map((row) => row.id) as [
  string,
  string,
  string,
];
const holdingOf = (s: PrototypeState, symbol: string, portfolioId: string) =>
  s.holdings.find(
    (each) =>
      each.portfolioId === portfolioId &&
      each.holding.asset_class === "instrument" &&
      each.holding.instrument_symbol === symbol,
  );
let ids = 0;
const newId = () =>
  `e9000000-0000-4000-8000-${String((ids += 1)).padStart(12, "0")}`;

// Microsoft, which no account holds, bought in IOL.
const msftPurchase = (portfolioId: string) => ({
  kind: "purchase",
  source_connection_id: IOL,
  instrument_symbol: "MSFT",
  date: TODAY,
  currency: "ARS",
  price: "15000",
  charges: [],
  reference: null,
  note: null,
  parts: [{ portfolio_id: portfolioId, quantity: "2" }],
});

describe("origin of what the user creates", () => {
  const holdingInput = {
    source_connection_id: COCOS,
    portfolio_id: PRINCIPAL,
    currency: null,
    instrument_symbol: null,
    annual_rate: null,
    started_on: null,
    matures_on: null,
    valued_on: null,
    label: null,
  };

  it("marks a holding typed by hand as manual", () => {
    const id = newId();
    const created = createHolding(
      state,
      { ...holdingInput, asset_class: "cash", amount: "100", currency: "ARS" },
      id,
    );
    expect(created.result).toEqual({ ok: true, id });
    expect(
      created.state.holdings.find((each) => each.holding.id === id)?.origin,
    ).toEqual({ kind: "manual" });
  });

  it("marks an instrument holding typed by hand as manual", () => {
    const id = newId();
    const created = createHolding(
      state,
      {
        ...holdingInput,
        asset_class: "instrument",
        instrument_symbol: "AAPL",
        amount: "2",
      },
      id,
    );
    expect(created.result).toEqual({ ok: true, id });
    expect(
      created.state.holdings.find((each) => each.holding.id === id)?.origin,
    ).toEqual({ kind: "manual" });
  });

  it("keeps an imported origin when the holding is typed in again after selling out", () => {
    const tsla = holdingOf(state, "TSLA", CORTO)!;
    expect(tsla.closed).toBe(true);
    const imported = {
      kind: "import" as const,
      fileName: "cocos.pdf",
      date: "2026-01-02",
    };
    const marked: PrototypeState = {
      ...state,
      holdings: state.holdings.map((each) =>
        each === tsla ? { ...each, origin: imported } : each,
      ),
    };
    const reopened = createHolding(
      marked,
      {
        ...holdingInput,
        portfolio_id: CORTO,
        asset_class: "instrument",
        instrument_symbol: "TSLA",
        amount: "3",
      },
      newId(),
    );
    expect(reopened.result).toEqual({ ok: true, id: tsla.holding.id });
    expect(holdingOf(reopened.state, "TSLA", CORTO)?.origin).toEqual(imported);
  });

  it("marks a holding a movement opens as manual", () => {
    const written = writeOperation(state, msftPurchase(PRINCIPAL), {
      operationId: newId(),
      newId,
    });
    expect(written.result.ok).toBe(true);
    expect(holdingOf(written.state, "MSFT", PRINCIPAL)?.origin).toEqual({
      kind: "manual",
    });
  });
});

describe("the report choice when an operation takes the last holding", () => {
  const bought = () => {
    const operationId = newId();
    const written = writeOperation(state, msftPurchase(PRINCIPAL), {
      operationId,
      newId,
    });
    expect(written.result.ok).toBe(true);
    const out = setInTaxReport(written.state, asset("instrument:MSFT"), false);
    expect(out.result.ok).toBe(true);
    return { operationId, state: out.state };
  };

  it("forgets it when the deleted operation was the asset's only one", () => {
    const { operationId, state: before } = bought();
    const deleted = deleteOperation(before, operationId);
    expect(deleted.result).toEqual({ ok: true, id: operationId });
    expect(holdingOf(deleted.state, "MSFT", PRINCIPAL)).toBeUndefined();
    expect(deleted.state.outOfTaxReport.has(asset("instrument:MSFT"))).toBe(
      false,
    );
  });

  it("keeps it when an edit moves the only holding to another portfolio", () => {
    const { operationId, state: before } = bought();
    const moved = writeOperation(before, msftPurchase(LARGO), {
      operationId,
      replacing: true,
      newId,
    });
    expect(moved.result).toEqual({ ok: true, id: operationId });
    expect(holdingOf(moved.state, "MSFT", PRINCIPAL)).toBeUndefined();
    expect(holdingOf(moved.state, "MSFT", LARGO)).toBeDefined();
    expect(moved.state.outOfTaxReport.has(asset("instrument:MSFT"))).toBe(true);
  });
  it("keeps an imported origin when an edit moves the only holding", () => {
    const operationId = newId();
    const imported = {
      kind: "import" as const,
      fileName: "iol.pdf",
      date: TODAY,
    };
    const written = writeOperation(state, msftPurchase(PRINCIPAL), {
      operationId,
      newId,
      origin: imported,
    });
    expect(holdingOf(written.state, "MSFT", PRINCIPAL)?.origin).toEqual(
      imported,
    );
    const moved = writeOperation(written.state, msftPurchase(LARGO), {
      operationId,
      replacing: true,
      newId,
    });
    expect(moved.result).toEqual({ ok: true, id: operationId });
    expect(holdingOf(moved.state, "MSFT", LARGO)?.origin).toEqual(imported);
  });
});

describe("the reading's demo for every account", () => {
  const readFor = (accountId: string) =>
    finishReading(
      addImport(state, { id: "i1", fileName: "resumen.pdf", accountId }).state,
      "i1",
    ).imports[0]!;
  const typeOf = (symbol: string) =>
    state.instruments.find((each) => each.symbol === symbol)!.type;

  it.each(state.accounts.map((each) => [each.institution, each.id]))(
    "suggests at %s only a type the account already holds",
    (_, accountId) => {
      const item = readFor(accountId);
      const extra = item.rows.find((row) => row.id.endsWith("-new"));
      if (!extra) return;
      const held = new Set(
        item.rows
          .filter((row) => row !== extra)
          .map((row) => typeOf(row.symbol)),
      );
      expect(held).toContain(typeOf(extra.symbol));
    },
  );

  it.each([
    ["IOL", "KO"],
    ["Cocos", "AAPL"],
    ["Binance", undefined],
  ])("suggests at %s %s", (institution, symbol) => {
    const extra = readFor(accountOf(institution).id).rows.find((row) =>
      row.id.endsWith("-new"),
    );
    expect(extra?.symbol).toBe(symbol);
  });

  // The demo's point: the misread row leaves the totals off, so the review
  // flags it. A misread row with no price is left out of the totals.
  it.each(["IOL", "Cocos", "Balanz"])(
    "makes %s's misread row not add up",
    (institution) => {
      const item = readFor(accountOf(institution).id);
      const misread = item.rows.find((row) => row.confidence === "low");
      expect(misread).toBeDefined();
      expect(totalsMatch(readTotals(item.rows), item.documentTotals)).toBe(
        false,
      );
      expect(misread?.price).not.toBeNull();
    },
  );
});

it("closes every month completely but those KO's opening balance leaves unpriced", () => {
  // KO opens long before its first purchase and before its first manual
  // price, so its first months have no price; every other holding, the new
  // bonds and FCI included, is priced from the day it opens.
  const ko = holdingOf(state, "KO", LARGO)!;
  const withoutKo = deleteHolding(state, ko.holding.id);
  expect(withoutKo.result.ok).toBe(true);
  for (const unit of ["ars", "usd_mep"] as const) {
    expect(
      closesOf(withoutKo.state, unit)
        .filter((each) => !each.complete)
        .map((each) => each.period),
    ).toEqual([]);
  }
});

describe("the assistant on what is priced by hand", () => {
  const snapshot = snapshotOn(state.quotes, TODAY, {
    fxKinds: ["mep", "ccl", "official", "uva"],
    symbols: state.instruments.map(({ symbol }) => symbol),
  }).snapshot;
  const ask = (question: string) =>
    prototypeAnswer(
      state,
      question,
      "ars",
      pricedSnapshotOf(state, snapshot).snapshot,
    ).text;

  it.each(["GD30", "FIMAAHO"])("values %s at its manual price", (symbol) => {
    const text = ask(`¿Cómo le fue a ${symbol}?`);
    expect(text).toMatch(new RegExp(`^Hoy tenés ${symbol} por \\$`));
    expect(text).not.toContain("sin cotización");
  });

  it("says TX26, with no price, has no value", () => {
    expect(ask("¿Cómo le fue a TX26?")).toContain(
      "Hoy tenés TX26 por un valor sin cotización",
    );
  });
});
