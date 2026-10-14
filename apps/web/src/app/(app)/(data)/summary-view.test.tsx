const readLedger = jest.fn();
const readHoldings = jest.fn();
const readLiabilities = jest.fn();
const read = jest.fn();
const notFound = jest.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});

jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("next/navigation", () => ({ notFound: () => notFound() }));
jest.mock("@/lib/auth/session-claims", () => ({
  getSessionClaims: async () => ({ sub: "u1" }),
}));
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
jest.mock("@/lib/request-id-server", () => ({
  currentRequestId: async () => undefined,
}));
jest.mock("@/lib/holdings/read", () => ({
  readHoldings: (...args: unknown[]) => readHoldings(...args),
  readReferenceDollar: async () => "ccl",
}));
jest.mock("@/lib/ledger/read", () => ({
  ...jest.requireActual("@/lib/ledger/read"),
  readLedger: (...args: unknown[]) => readLedger(...args),
}));
jest.mock("@/lib/debts/read", () => ({
  ...jest.requireActual("@/lib/debts/read"),
  readLiabilities: (...args: unknown[]) => readLiabilities(...args),
}));
jest.mock("@/lib/quotes/quote-reader", () => ({
  createQuoteReader: () => ({ read }),
}));
// No pins: Resumen draws none, so it reads no chart.
jest.mock("@/lib/assistant/pins", () => ({ readPins: async () => [] }));
// The server action Resumen hands the page to unpin a chart.
const unpinChart = async () => true;
jest.mock("@/app/(app)/(data)/assistant/actions", () => ({ unpinChart }));
jest.mock("@/components/summary/summary-page", () => ({
  SummaryPage: () => null,
}));
jest.mock("@/components/summary/close-detail", () => ({
  MonthCloseDetail: () => null,
  YearCloseDetail: () => null,
}));

import type { QuoteRange } from "@plant/core";
import { holdingSchema } from "@plant/core";
import type * as React from "react";

import type { HoldingRow } from "@/lib/holdings/read";
import { holdingsView, writeOperation } from "@/lib/ledger/ledger";
import {
  ACCOUNT,
  emptyLedger,
  OTHER_PORTFOLIO,
  PORTFOLIO,
  PURCHASE,
} from "@/lib/ledger/ledger-fixture.test-support";
import { captureServerLog } from "@/lib/log/capture-server-log";
import type { MonthClose, MonthDetail, YearClose } from "@/lib/summary/closes";
import { functionsIn } from "@/test/client-props";

import { CloseView, SummaryView } from "./summary-view";

const bought = writeOperation(emptyLedger(), PURCHASE, {
  operationId: "0f000000-0000-4000-8000-00000000000f",
  newId: () => crypto.randomUUID(),
}).state;

// Every quote asked for, on the last day of its range: dollars at 1250 and
// AAPL at 20000 pesos.
const quotesOf = ({ to, fxKinds, symbols }: QuoteRange) => ({
  fxRates: fxKinds.map((kind) => ({ kind, rate_date: to, sell: "1250" })),
  prices: symbols
    .filter((symbol) => symbol === "AAPL")
    .map((symbol) => ({
      symbol,
      price_date: to,
      price: "20000",
      currency: "ARS" as const,
    })),
});

const CASH: HoldingRow = {
  id: "c1000000-0000-4000-8000-0000000000c1",
  holding: holdingSchema.parse({
    id: "c1000000-0000-4000-8000-0000000000c1",
    asset_class: "cash",
    portfolio_id: PORTFOLIO,
    amount: "125000",
    currency: "ARS",
    instrument_symbol: null,
    annual_rate: null,
    started_on: null,
    matures_on: null,
    valued_on: null,
    label: null,
  }),
  account: { id: ACCOUNT, institution: "IOL" },
  portfolio: { id: PORTFOLIO, name: "Principal" },
  instrumentType: null,
};

const PERSONAL_LOAN = {
  id: "d1",
  kind: "personal_loan",
  label: "Préstamo",
  lender: null,
  currency: "ARS",
  uva: false,
  instrument_symbol: null,
  balance: "62500",
  installment: null,
  annual_rate: null,
  installments_left: null,
  next_due_on: null,
  matures_on: null,
};

const debtsOf = (active: unknown[]) => ({
  active,
  activeTruncated: false,
  archived: [],
  archivedPage: null,
  archivedFirstHref: null,
  archivedNextHref: null,
});

type SummaryProps = {
  closes: MonthClose[];
  years: YearClose[];
  year: YearClose | undefined;
  rows: HoldingRow[];
  portfolio: { id: string } | null;
  unit: string;
  closesQuery: string;
};

let lines: Record<string, unknown>[];
beforeEach(() => {
  lines = captureServerLog();
  notFound.mockClear();
  readLedger.mockResolvedValue({
    ledger: bought,
    truncated: false,
    symbolOf: new Map(),
  });
  readHoldings.mockResolvedValue(holdingsView(bought));
  readLiabilities.mockResolvedValue(debtsOf([]));
  read.mockReset();
  read.mockImplementation(async (range: QuoteRange) => quotesOf(range));
});

const summary = async (params: Record<string, string> = {}) =>
  (await SummaryView({ params })) as React.ReactElement<SummaryProps>;

describe("Resumen", () => {
  it("closes every month from the first movement's, in the reference dollar", async () => {
    const page = await summary();
    expect(page.props.unit).toBe("usd_ccl");
    expect(page.props.closes.map((each) => each.period)).toEqual([
      "2026-09",
      "2026-10",
    ]);
    // 5 AAPL at 20000 pesos, at 1250 pesos the dollar.
    expect(page.props.closes.at(-1)!.figures.endValue).toBe("80");
    expect(page.props.closesQuery).toBe("");
    expect(lines.at(-1)).toMatchObject({
      event: "summary.view",
      "plant.page": "/",
      "plant.outcome": "ok",
      "plant.closes.month_count": 2,
      "plant.assets.holding_count": 2,
    });
  });

  it("reads the quotes of each day a close values at, and of today", async () => {
    await summary();
    const ends = read.mock.calls.map(([range]: [QuoteRange]) => range.to);
    expect(ends).toEqual(
      expect.arrayContaining(["2026-08-31", "2026-09-30", "2026-10-12"]),
    );
    for (const [range] of read.mock.calls as [QuoteRange][]) {
      expect(range.symbols).toContain("AAPL");
      expect(range.fxKinds).toEqual(expect.arrayContaining(["ccl", "uva"]));
    }
  });

  it("counts a holding with no movements at today's amount", async () => {
    const view = holdingsView(bought);
    readHoldings.mockResolvedValue({ ...view, active: [...view.active, CASH] });
    const page = await summary();
    // 80 dollars of AAPL and 100 of cash.
    expect(page.props.closes.at(-1)!.figures.endValue).toBe("180");
    expect(page.props.closes[0]!.figures.startValue).toBe("100");
  });

  it("takes the debts off the net worth", async () => {
    readLiabilities.mockResolvedValue(debtsOf([PERSONAL_LOAN]));
    const page = await summary();
    expect(page.props.closes.at(-1)!.figures.endValue).toBe("30");
  });

  it("shows one portfolio's holdings with ?portfolio", async () => {
    const page = await summary({ portfolio: OTHER_PORTFOLIO });
    expect(page.props.portfolio).toMatchObject({ id: OTHER_PORTFOLIO });
    expect(page.props.rows.map((row) => row.portfolio.id)).toEqual([
      OTHER_PORTFOLIO,
    ]);
    expect(lines.at(-1)).toMatchObject({ "plant.summary.portfolio": true });
  });

  it("keeps ?unit in the closes' links, and a unit closes lack falls back", async () => {
    expect((await summary({ unit: "ars" })).props.closesQuery).toBe(
      "?unit=ars",
    );
    expect((await summary({ unit: "btc" })).props.unit).toBe("usd_ccl");
  });

  it("hands the page only data, and the server action that unpins", async () => {
    expect(functionsIn((await summary()).props)).toEqual([unpinChart]);
  });
});

describe("a close's page", () => {
  const close = async (period: string, params: Record<string, string> = {}) =>
    (await CloseView({ period, params })) as React.ReactElement<{
      detail?: MonthDetail;
      year?: YearClose;
      backHref: string;
      closesQuery?: string;
    }>;

  it("shows a month's movements and goes back to Resumen", async () => {
    const page = await close("2026-09", { unit: "ars" });
    expect(page.props.detail!.close.period).toBe("2026-09");
    expect(page.props.detail!.lines).toHaveLength(2);
    expect(page.props.backHref).toBe("/?unit=ars");
    expect(lines.at(-1)).toMatchObject({
      event: "summary.view",
      "plant.closes.period": "month",
    });
  });

  it("shows a year's months", async () => {
    const page = await close("2026");
    expect(page.props.year!.months).toHaveLength(2);
    expect(page.props.closesQuery).toBe("");
    expect(functionsIn(page.props)).toEqual([]);
  });

  it.each(["2025-01", "2024", "2026-13x", "nope"])(
    "has no page for %s",
    async (period) => {
      await expect(close(period)).rejects.toThrow("NEXT_NOT_FOUND");
    },
  );
});
