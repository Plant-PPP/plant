import { heldIn } from "@/lib/imports/confirm";
import { type Holding, snapshotOn } from "@plant/core";
import { compareDecimals } from "@plant/shared";

import { readTotals, totalsMatch } from "@/lib/imports/review";
import { buildFixtures } from "@/lib/prototype/fixtures";

import { prototypeAnswer } from "./prototype-assistant";
import { createAccount } from "./prototype-accounts-store";
import { closesOf } from "@/lib/summary/compute";
import {
  addImport,
  confirmImport,
  finishReading,
} from "./prototype-imports-store";
import {
  createHolding,
  deleteHolding,
  deleteOperation,
  initialState,
  operationOf,
  pricedSnapshotOf,
  priceToday,
  type PrototypeState,
  setInTaxReport,
  setPrice,
  writeOperation,
} from "./prototype-store";

import { assetKey } from "@/lib/holdings/assets-rows";

const TODAY = "2026-10-12";
const fixtures = buildFixtures(TODAY);
const state = initialState(fixtures, TODAY);
// An instrument's asset key as the store makes it, from a holding of it.
const anInstrument = state.holdings
  .map((each) => each.holding)
  .find(
    (holding): holding is Extract<Holding, { asset_class: "instrument" }> =>
      holding.asset_class === "instrument",
  )!;
const instrumentKey = (symbol: string) =>
  assetKey({ ...anInstrument, instrument_symbol: symbol });
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
    const out = setInTaxReport(written.state, instrumentKey("MSFT"), false);
    expect(out.result.ok).toBe(true);
    return { operationId, state: out.state };
  };

  it("forgets it when the deleted operation was the asset's only one", () => {
    const { operationId, state: before } = bought();
    const deleted = deleteOperation(before, operationId);
    expect(deleted.result).toEqual({ ok: true, id: operationId });
    expect(holdingOf(deleted.state, "MSFT", PRINCIPAL)).toBeUndefined();
    expect(deleted.state.outOfTaxReport.has(instrumentKey("MSFT"))).toBe(false);
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
    expect(moved.state.outOfTaxReport.has(instrumentKey("MSFT"))).toBe(true);
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
    "suggests at %s only a type the account already holds in that currency",
    (_, accountId) => {
      const item = readFor(accountId);
      const extra = item.rows.find((row) => row.id.endsWith("-new"));
      if (!extra) return;
      const kindOf = (row: { symbol: string; currency: string }) =>
        `${typeOf(row.symbol)}:${row.currency}`;
      const held = new Set(
        item.rows.filter((row) => row !== extra).map(kindOf),
      );
      expect(held).toContain(kindOf(extra));
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

  // The demo's point: the misread row, a priced one, leaves the totals off,
  // so the review flags it.
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

describe("origin of a holding an edit creates", () => {
  const imported = {
    kind: "import" as const,
    fileName: "iol.pdf",
    date: TODAY,
  };
  const msftIn = (...parts: [string, string][]) => ({
    ...msftPurchase(PRINCIPAL),
    parts: parts.map(([portfolio_id, quantity]) => ({
      portfolio_id,
      quantity,
    })),
  });
  const edit = (before: PrototypeState, operationId: string, input: unknown) =>
    writeOperation(before, input, { operationId, replacing: true, newId });

  it("gives a portfolio a split adds its operation's origin", () => {
    const operationId = newId();
    const written = writeOperation(state, msftIn([PRINCIPAL, "2"]), {
      operationId,
      newId,
      origin: imported,
    });
    expect(written.result.ok).toBe(true);
    const split = edit(
      written.state,
      operationId,
      msftIn([PRINCIPAL, "1"], [LARGO, "1"]),
    );
    expect(split.result).toEqual({ ok: true, id: operationId });
    expect(holdingOf(split.state, "MSFT", PRINCIPAL)?.origin).toEqual(imported);
    expect(holdingOf(split.state, "MSFT", LARGO)?.origin).toEqual(imported);
  });

  it("gives a holding an edit of a hand-typed operation creates no import origin, even out of an imported holding", () => {
    const first = writeOperation(state, msftIn([PRINCIPAL, "2"]), {
      operationId: newId(),
      newId,
      origin: imported,
    });
    const typedId = newId();
    const typed = writeOperation(first.state, msftIn([PRINCIPAL, "1"]), {
      operationId: typedId,
      newId,
    });
    expect(typed.result.ok).toBe(true);
    const moved = edit(typed.state, typedId, msftIn([LARGO, "1"]));
    expect(moved.result).toEqual({ ok: true, id: typedId });
    expect(holdingOf(moved.state, "MSFT", PRINCIPAL)?.origin).toEqual(imported);
    expect(holdingOf(moved.state, "MSFT", LARGO)?.origin).toEqual({
      kind: "manual",
    });
  });

  it("takes the origin of the operation, whatever the holdings' order", () => {
    const operationId = newId();
    const written = writeOperation(
      state,
      msftIn([PRINCIPAL, "2"], [LARGO, "1"]),
      { operationId, newId, origin: imported },
    );
    expect(written.result.ok).toBe(true);
    const reordered: PrototypeState = {
      ...written.state,
      holdings: [...written.state.holdings].reverse(),
    };
    const input = msftIn([CORTO, "2"], [LARGO, "1"]);
    for (const before of [written.state, reordered]) {
      const moved = edit(before, operationId, input);
      expect(moved.result).toEqual({ ok: true, id: operationId });
      expect(holdingOf(moved.state, "MSFT", CORTO)?.origin).toEqual(imported);
    }
  });

  it("forgets where a deleted operation came from", () => {
    const operationId = newId();
    const written = writeOperation(state, msftIn([PRINCIPAL, "2"]), {
      operationId,
      newId,
      origin: imported,
    });
    expect(written.state.operationOrigins.get(operationId)).toEqual(imported);
    const deleted = deleteOperation(written.state, operationId);
    expect(deleted.state.operationOrigins.has(operationId)).toBe(false);
  });

  it("gives every holding a new operation creates its `origin`, not another holding's", () => {
    const tsla = holdingOf(state, "TSLA", CORTO)!;
    const marked: PrototypeState = {
      ...state,
      holdings: state.holdings.map((each) =>
        each === tsla ? { ...each, origin: imported } : each,
      ),
    };
    const written = writeOperation(
      marked,
      msftIn([PRINCIPAL, "1"], [LARGO, "1"]),
      { operationId: newId(), newId },
    );
    expect(written.result.ok).toBe(true);
    for (const portfolioId of [PRINCIPAL, LARGO]) {
      expect(holdingOf(written.state, "MSFT", portfolioId)?.origin).toEqual({
        kind: "manual",
      });
    }
    const fromImport = writeOperation(
      marked,
      msftIn([PRINCIPAL, "1"], [LARGO, "1"]),
      { operationId: newId(), newId, origin: imported },
    );
    for (const portfolioId of [PRINCIPAL, LARGO]) {
      expect(holdingOf(fromImport.state, "MSFT", portfolioId)?.origin).toEqual(
        imported,
      );
    }
  });
});

describe("the reading's misread row with few priced rows", () => {
  const ACCOUNT = "a9100000-0000-4000-8000-000000000001";
  // A new account holding 20 of each given ARS instrument.
  const holding = (...symbols: string[]) => {
    let next = createAccount(
      state,
      {
        institution: "Banco de prueba",
        includeInTaxReport: true,
        defaultPortfolioId: PRINCIPAL,
      },
      ACCOUNT,
    ).state;
    for (const symbol of symbols) {
      const written = writeOperation(
        next,
        {
          ...msftPurchase(PRINCIPAL),
          source_connection_id: ACCOUNT,
          instrument_symbol: symbol,
          price: "1000",
          parts: [{ portfolio_id: PRINCIPAL, quantity: "20" }],
        },
        { operationId: newId(), newId },
      );
      expect(written.result.ok).toBe(true);
      next = written.state;
    }
    return finishReading(
      addImport(next, { id: "i7", fileName: "banco.pdf", accountId: ACCOUNT })
        .state,
      "i7",
    ).imports[0]!;
  };

  it("misreads the one priced row when nothing is suggested", () => {
    // FIMAAHO is priced by hand; TX26 has no price.
    const item = holding("FIMAAHO", "TX26");
    expect(item.status).toBe("ready");
    expect(item.rows.some((row) => row.id.endsWith("-new"))).toBe(false);
    const low = item.rows.filter((row) => row.confidence === "low");
    expect(low.map((row) => row.symbol)).toEqual(["FIMAAHO"]);
    expect(totalsMatch(readTotals(item.rows), item.documentTotals)).toBe(false);
  });

  it("never misreads the suggested row, even when it is the only one priced", () => {
    // MSFT has no price; the suggested CEDEAR has one.
    const item = holding("MSFT");
    expect(item.status).toBe("ready");
    const extra = item.rows.find((row) => row.id.endsWith("-new"));
    expect(extra).toBeDefined();
    expect(item.rows.filter((row) => row.price !== null)).toEqual([extra]);
    expect(item.rows.some((row) => row.confidence === "low")).toBe(false);
    expect(extra?.quantity).toBe("3");
  });

  it.each(state.accounts.map((each) => [each.institution, each.id]))(
    "never misreads %s's suggested row",
    (_, accountId) => {
      const item = finishReading(
        addImport(state, { id: "i6", fileName: "resumen.pdf", accountId })
          .state,
        "i6",
      ).imports[0]!;
      for (const row of item.rows.filter((each) => each.id.endsWith("-new"))) {
        expect(row.confidence).not.toBe("low");
      }
    },
  );
});

describe("where each operation came from, through its lifecycle", () => {
  const imported = {
    kind: "import" as const,
    fileName: "balanz.pdf",
    date: TODAY,
  };
  const msftIn = (...parts: [string, string][]) => ({
    ...msftPurchase(PRINCIPAL),
    parts: parts.map(([portfolio_id, quantity]) => ({
      portfolio_id,
      quantity,
    })),
  });
  const importOf = (input: unknown) => {
    const operationId = newId();
    const written = writeOperation(state, input, {
      operationId,
      newId,
      origin: imported,
    });
    expect(written.result).toEqual({ ok: true, id: operationId });
    return { operationId, after: written.state };
  };
  const edit = (before: PrototypeState, operationId: string, input: unknown) =>
    writeOperation(before, input, { operationId, replacing: true, newId });

  it("records an imported operation, and no hand-typed one", () => {
    const { operationId, after } = importOf(msftIn([PRINCIPAL, "2"]));
    expect([...after.operationOrigins]).toEqual([[operationId, imported]]);
    const typedId = newId();
    const typed = writeOperation(after, msftIn([PRINCIPAL, "1"]), {
      operationId: typedId,
      newId,
    });
    expect(typed.result.ok).toBe(true);
    expect(typed.state.operationOrigins).toBe(after.operationOrigins);
  });

  it("keeps an imported operation's origin through an edit, and the next edit still creates from it", () => {
    const { operationId, after } = importOf(msftIn([PRINCIPAL, "2"]));
    const edited = edit(after, operationId, msftIn([PRINCIPAL, "3"]));
    expect(edited.result).toEqual({ ok: true, id: operationId });
    expect(edited.state.operationOrigins.get(operationId)).toEqual(imported);
    const moved = edit(edited.state, operationId, msftIn([CORTO, "3"]));
    expect(moved.result).toEqual({ ok: true, id: operationId });
    expect(holdingOf(moved.state, "MSFT", CORTO)?.origin).toEqual(imported);
    expect(moved.state.operationOrigins.get(operationId)).toEqual(imported);
  });

  it("records nothing for an edit of a hand-typed operation", () => {
    const typedId = newId();
    const typed = writeOperation(state, msftIn([PRINCIPAL, "2"]), {
      operationId: typedId,
      newId,
    });
    const edited = edit(typed.state, typedId, msftIn([CORTO, "2"]));
    expect(edited.result).toEqual({ ok: true, id: typedId });
    expect(edited.state.operationOrigins.has(typedId)).toBe(false);
    expect(holdingOf(edited.state, "MSFT", CORTO)?.origin).toEqual({
      kind: "manual",
    });
  });

  it("leaves the origins as they were when a write is refused", () => {
    const { operationId, after } = importOf(msftIn([PRINCIPAL, "2"]));
    const refusals = [
      // Not an operation at all.
      writeOperation(
        after,
        { kind: "purchase" },
        {
          operationId: newId(),
          newId,
          origin: imported,
        },
      ),
      // A new operation under an id that already has one.
      writeOperation(after, msftIn([PRINCIPAL, "1"]), {
        operationId,
        newId,
        origin: { kind: "import", fileName: "otro.pdf", date: TODAY },
      }),
      // An edit of an operation that does not exist.
      writeOperation(after, msftIn([PRINCIPAL, "1"]), {
        operationId: newId(),
        replacing: true,
        newId,
        origin: imported,
      }),
      // An edit that moves the operation to another account.
      edit(after, operationId, {
        ...msftIn([PRINCIPAL, "2"]),
        source_connection_id: COCOS,
      }),
    ];
    for (const refused of refusals) {
      expect(refused.result.ok).toBe(false);
      expect(refused.state).toBe(after);
      expect(refused.state.operationOrigins).toBe(after.operationOrigins);
    }
  });

  it("keeps the origins the same map when a hand-typed operation is deleted", () => {
    const { after } = importOf(msftIn([PRINCIPAL, "2"]));
    const typedId = newId();
    const typed = writeOperation(after, msftIn([LARGO, "1"]), {
      operationId: typedId,
      newId,
    }).state;
    const deleted = deleteOperation(typed, typedId);
    expect(deleted.result).toEqual({ ok: true, id: typedId });
    expect(deleted.state.operationOrigins).toBe(typed.operationOrigins);
    expect(deleteOperation(typed, newId()).state).toBe(typed);
  });

  it("keeps an operation's origin when one of its holdings is deleted and another part remains", () => {
    const { operationId, after } = importOf(
      msftIn([PRINCIPAL, "2"], [LARGO, "1"]),
    );
    const principal = holdingOf(after, "MSFT", PRINCIPAL)!.holding.id;
    const removed = deleteHolding(after, principal);
    expect(removed.result).toEqual({ ok: true, id: principal });
    expect(removed.state.operationOrigins.get(operationId)).toEqual(imported);
    expect(operationOf(removed.state, operationId)?.parts).toHaveLength(1);
    const moved = edit(removed.state, operationId, msftIn([CORTO, "1"]));
    expect(moved.result).toEqual({ ok: true, id: operationId });
    expect(holdingOf(moved.state, "MSFT", CORTO)?.origin).toEqual(imported);
    expect(moved.state.operationOrigins.get(operationId)).toEqual(imported);
  });

  it("leaves no operation, and no origin, once its only holding is deleted", () => {
    const { operationId, after } = importOf(msftIn([PRINCIPAL, "2"]));
    const holdingId = holdingOf(after, "MSFT", PRINCIPAL)!.holding.id;
    const removed = deleteHolding(after, holdingId).state;
    expect(operationOf(removed, operationId)).toBeNull();
    expect(removed.operationOrigins.has(operationId)).toBe(false);
    expect(deleteOperation(removed, operationId).result).toEqual({
      ok: false,
      code: "not_found",
    });
    expect(edit(removed, operationId, msftIn([CORTO, "2"])).result).toEqual({
      ok: false,
      code: "not_found",
    });
  });

  it("records the import as the origin of every operation a confirmed reading writes", () => {
    const iol = state.accounts.find((each) => each.id === IOL)!;
    const read = finishReading(
      addImport(state, { id: "i8", fileName: "iol.pdf", accountId: iol.id })
        .state,
      "i8",
    );
    const item = read.imports[0]!;
    const held = heldIn(read, IOL);
    const changed = item.rows.filter(
      (row) =>
        !row.discarded &&
        compareDecimals(row.quantity, held.get(row.symbol) ?? "0") !== 0,
    );
    expect(changed.length).toBeGreaterThanOrEqual(2);
    const confirmed = confirmImport(read, "i8", item.rows, newId);
    expect(confirmed.result).toEqual({ ok: true, id: "i8" });
    const origins = [...confirmed.state.operationOrigins];
    expect(origins).toHaveLength(changed.length);
    for (const [operationId, origin] of origins) {
      expect(origin).toEqual({
        kind: "import",
        fileName: "iol.pdf",
        date: TODAY,
      });
      expect(operationOf(confirmed.state, operationId)?.accountId).toBe(IOL);
    }
    expect(
      new Set(
        origins.map(
          ([operationId]) =>
            operationOf(confirmed.state, operationId)!.instrument,
        ),
      ),
    ).toEqual(new Set(changed.map((row) => row.symbol)));
  });
});

describe("the reading's misread row and suggestion", () => {
  it.each(
    state.accounts
      .filter((each) => heldIn(state, each.id).size > 0)
      .map((each) => [each.institution, each.id]),
  )(
    "misreads, in %s, the last of its held rows with a price, never the suggested one",
    (_, accountId) => {
      const item = finishReading(
        addImport(state, { id: "i10", fileName: "resumen.pdf", accountId })
          .state,
        "i10",
      ).imports[0]!;
      expect(item.status).toBe("ready");
      const held = [...heldIn(state, accountId).keys()];
      const heldRows = item.rows.filter((row) => !row.id.endsWith("-new"));
      expect(heldRows.map((row) => row.symbol).sort()).toEqual(held.sort());
      const low = item.rows.filter((row) => row.confidence === "low");
      expect(low.length).toBeLessThanOrEqual(1);
      const expected = heldRows.filter((row) => row.price !== null).at(-1);
      if (low[0]) {
        expect(low[0].id).toBe(expected?.id);
        expect(held).toContain(low[0].symbol);
      }
    },
  );

  it("suggests only a type the account holds in that same currency", () => {
    const ACCOUNT = "a9200000-0000-4000-8000-000000000001";
    // AL30 is an ARS bond; with a price it would pair the USD bond's type
    // with the ARS fund's currency.
    let next = setPrice(state, {
      symbol: "AL30",
      price_date: TODAY,
      price: "60000",
      currency: "ARS",
    }).state;
    expect(
      priceToday(next, { symbol: "AL30", currency: "ARS" }),
    ).not.toBeNull();
    next = createAccount(
      next,
      {
        institution: "Banco de prueba",
        includeInTaxReport: true,
        defaultPortfolioId: PRINCIPAL,
      },
      ACCOUNT,
    ).state;
    for (const [symbol, currency] of [
      ["GD30", "USD"],
      ["FIMAAHO", "ARS"],
    ] as const) {
      const written = writeOperation(
        next,
        {
          ...msftPurchase(PRINCIPAL),
          source_connection_id: ACCOUNT,
          instrument_symbol: symbol,
          currency,
          price: "1",
          parts: [{ portfolio_id: PRINCIPAL, quantity: "20" }],
        },
        { operationId: newId(), newId },
      );
      expect(written.result.ok).toBe(true);
      next = written.state;
    }
    const kindOf = (symbol: string) => {
      const instrument = next.instruments.find(
        (each) => each.symbol === symbol,
      )!;
      return `${instrument.type}:${instrument.currency}`;
    };
    expect(kindOf("AL30")).toBe("bond:ARS");
    const item = finishReading(
      addImport(next, { id: "i11", fileName: "banco.pdf", accountId: ACCOUNT })
        .state,
      "i11",
    ).imports[0]!;
    expect(item.status).toBe("ready");
    for (const row of item.rows.filter((each) => each.id.endsWith("-new"))) {
      expect(["bond:USD", "fci:ARS"]).toContain(kindOf(row.symbol));
    }
    expect(item.rows.map((row) => row.symbol)).not.toContain("AL30");
  });
});

describe("an operation's origin when an edit or a delete empties a holding", () => {
  const imported = {
    kind: "import" as const,
    fileName: "balanz.pdf",
    date: TODAY,
  };
  const msftIn = (...parts: [string, string][]) => ({
    ...msftPurchase(PRINCIPAL),
    parts: parts.map(([portfolio_id, quantity]) => ({
      portfolio_id,
      quantity,
    })),
  });
  const write = (
    before: PrototypeState,
    input: unknown,
    origin?: typeof imported,
  ) => {
    const operationId = newId();
    const written = writeOperation(before, input, {
      operationId,
      newId,
      ...(origin && { origin }),
    });
    expect(written.result).toEqual({ ok: true, id: operationId });
    return { operationId, after: written.state };
  };
  const edit = (before: PrototypeState, operationId: string, input: unknown) =>
    writeOperation(before, input, { operationId, replacing: true, newId });

  it("keeps an imported operation's origin when an edit empties its holding and creates another", () => {
    const { operationId, after } = write(
      state,
      msftIn([PRINCIPAL, "2"]),
      imported,
    );
    const moved = edit(after, operationId, msftIn([CORTO, "2"]));
    expect(moved.result).toEqual({ ok: true, id: operationId });
    expect(holdingOf(moved.state, "MSFT", PRINCIPAL)).toBeUndefined();
    expect(holdingOf(moved.state, "MSFT", CORTO)?.origin).toEqual(imported);
    expect(moved.state.operationOrigins.get(operationId)).toEqual(imported);
    expect(after.operationOrigins.get(operationId)).toEqual(imported);
    const deleted = deleteOperation(moved.state, operationId);
    expect(deleted.result).toEqual({ ok: true, id: operationId });
    expect(deleted.state.operationOrigins.has(operationId)).toBe(false);
  });

  it("leaves no origin for a hand-typed operation an edit moves the same way", () => {
    const { operationId, after } = write(state, msftIn([PRINCIPAL, "2"]));
    const moved = edit(after, operationId, msftIn([CORTO, "2"]));
    expect(moved.result).toEqual({ ok: true, id: operationId });
    expect(holdingOf(moved.state, "MSFT", PRINCIPAL)).toBeUndefined();
    expect(moved.state.operationOrigins.has(operationId)).toBe(false);
    expect([...moved.state.operationOrigins]).toEqual([
      ...after.operationOrigins,
    ]);
    expect(holdingOf(moved.state, "MSFT", CORTO)?.origin).toEqual({
      kind: "manual",
    });
  });

  it("keeps a split imported operation's origin when an edit empties both its holdings into a third portfolio", () => {
    const { operationId, after } = write(
      state,
      msftIn([PRINCIPAL, "2"], [LARGO, "1"]),
      imported,
    );
    const moved = edit(after, operationId, msftIn([CORTO, "3"]));
    expect(moved.result).toEqual({ ok: true, id: operationId });
    expect(holdingOf(moved.state, "MSFT", PRINCIPAL)).toBeUndefined();
    expect(holdingOf(moved.state, "MSFT", LARGO)).toBeUndefined();
    expect(holdingOf(moved.state, "MSFT", CORTO)?.origin).toEqual(imported);
    expect(moved.state.operationOrigins.get(operationId)).toEqual(imported);
    expect(operationOf(moved.state, operationId)?.parts).toHaveLength(1);
  });

  it("keeps another imported operation's origin when an edit empties a holding", () => {
    const other = write(state, msftIn([LARGO, "1"]), imported);
    const { operationId, after } = write(
      other.after,
      msftIn([PRINCIPAL, "2"]),
      imported,
    );
    const moved = edit(after, operationId, msftIn([LARGO, "2"]));
    expect(moved.result).toEqual({ ok: true, id: operationId });
    expect(holdingOf(moved.state, "MSFT", PRINCIPAL)).toBeUndefined();
    expect(moved.state.operationOrigins.get(operationId)).toEqual(imported);
    expect(moved.state.operationOrigins.get(other.operationId)).toEqual(
      imported,
    );
  });

  it("drops only the origin of the operation a deleted holding held whole", () => {
    const shared = write(state, msftIn([PRINCIPAL, "1"], [LARGO, "1"]), {
      ...imported,
      fileName: "compartida.pdf",
    });
    const only = write(shared.after, msftIn([PRINCIPAL, "2"]), imported);
    const principal = holdingOf(only.after, "MSFT", PRINCIPAL)!.holding.id;
    expect(only.after.movements.get(principal)).toHaveLength(2);
    const removed = deleteHolding(only.after, principal);
    expect(removed.result).toEqual({ ok: true, id: principal });
    expect(removed.state.operationOrigins.has(only.operationId)).toBe(false);
    expect(removed.state.operationOrigins.get(shared.operationId)).toEqual({
      ...imported,
      fileName: "compartida.pdf",
    });
    expect(operationOf(removed.state, only.operationId)).toBeNull();
    expect(operationOf(removed.state, shared.operationId)?.parts).toHaveLength(
      1,
    );
    expect(only.after.operationOrigins.has(only.operationId)).toBe(true);
  });
});
