const getSessionClaims = jest.fn();
const readHoldings = jest.fn();
const readInstruments = jest.fn();
const readReferenceDollar = jest.fn();
const readSourceConnections = jest.fn();
const readPortfolios = jest.fn();
const read = jest.fn();

jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("@/lib/auth/session-claims", () => ({
  getSessionClaims: () => getSessionClaims(),
}));
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
jest.mock("@/lib/request-id-server", () => ({
  currentRequestId: async () => "12345678-aaaa-4bbb-8ccc-dddddddddddd",
}));
jest.mock("@/lib/holdings/read", () => ({
  readHoldings: (...args: unknown[]) => readHoldings(...args),
  readInstruments: (...args: unknown[]) => readInstruments(...args),
  readReferenceDollar: (...args: unknown[]) => readReferenceDollar(...args),
}));
jest.mock("@/lib/portfolio-setup/read", () => ({
  ...jest.requireActual("@/lib/portfolio-setup/read"),
  readSourceConnections: (...args: unknown[]) => readSourceConnections(...args),
  readPortfolios: (...args: unknown[]) => readPortfolios(...args),
}));
jest.mock("@/lib/quotes/quote-reader", () => ({
  createQuoteReader: () => ({ read }),
}));
jest.mock("@/components/holdings/assets-setup", () => ({
  AssetsSetup: () => null,
}));
jest.mock("@/components/prototype/prototype-assets", () => ({
  PrototypeAssets: () => null,
}));

import { QuoteStoreError, holdingSchema } from "@plant/core";
import type * as React from "react";

import type { AssetsFilter } from "@/lib/holdings/assets-filter";
import type { HoldingsValuation } from "@/lib/holdings/valuation-view";
import { captureServerLog } from "@/lib/log/capture-server-log";
import { isLoggedError } from "@/lib/log/logged-error";

import AssetsPage from "./page";

const USER = "11111111-1111-4111-8111-111111111111";
const P1 = "b1000000-0000-4000-8000-0000000000b1";
const P2 = "b2000000-0000-4000-8000-0000000000b2";

const list = <Row,>(active: Row[]) => ({
  active,
  activeTruncated: false,
  archived: [],
  archivedPage: null,
  archivedFirstHref: null,
  archivedNextHref: null,
});

const holding = (id: string, portfolio_id: string, amount: string) => ({
  id,
  holding: holdingSchema.parse({
    id,
    portfolio_id,
    asset_class: "cash",
    instrument_symbol: null,
    amount,
    currency: "USD",
    annual_rate: null,
    started_on: null,
    matures_on: null,
    valued_on: null,
    label: null,
  }),
  account: { id: "a1", institution: "IOL" },
  portfolio: {
    id: portfolio_id,
    name: portfolio_id === P1 ? "Principal" : "Largo plazo",
  },
});

let lines: Record<string, unknown>[];

const savedEnv = process.env.VERCEL_ENV;
beforeAll(() => {
  process.env.VERCEL_ENV = "production";
});
afterAll(() => {
  if (savedEnv === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = savedEnv;
});

beforeEach(() => {
  jest.resetAllMocks();
  lines = captureServerLog();
  getSessionClaims.mockResolvedValue({ sub: USER });
  readHoldings.mockResolvedValue(
    list([holding("h1", P1, "100"), holding("h2", P2, "50")]),
  );
  readInstruments.mockResolvedValue({ rows: [], truncated: false });
  readReferenceDollar.mockResolvedValue("ccl");
  readSourceConnections.mockResolvedValue(list([]));
  readPortfolios.mockResolvedValue(
    list([
      { id: P2, name: "Largo plazo" },
      { id: P1, name: "Principal" },
    ]),
  );
  read.mockResolvedValue({
    fxRates: [
      { kind: "mep", rate_date: "2026-10-09", sell: "1200" },
      { kind: "ccl", rate_date: "2026-10-09", sell: "1250" },
    ],
    prices: [],
  });
});

afterEach(() => jest.restoreAllMocks());

type Props = {
  unit: string;
  referenceUnit: string;
  filter: AssetsFilter;
  valuation: HoldingsValuation;
};

async function render(params: Record<string, string> = {}) {
  const page = (await AssetsPage({
    searchParams: Promise.resolve(params),
  })) as React.ReactElement<{ children: React.ReactElement<Props>[] }>;
  return page.props.children[1]!.props;
}

const viewLine = () => lines.find((line) => line.event === "assets.view");

const VIEW_KEYS = [
  "enduser.id",
  "event",
  "level",
  "plant.assets.asset_class",
  "plant.assets.filtered",
  "plant.assets.holding_count",
  "plant.assets.instruments_truncated",
  "plant.assets.invalid_class",
  "plant.assets.invalid_portfolio",
  "plant.assets.invalid_search",
  "plant.assets.invalid_tab",
  "plant.assets.invalid_unit",
  "plant.assets.missing_count",
  "plant.assets.searched",
  "plant.assets.shown_count",
  "plant.assets.tab",
  "plant.assets.truncated",
  "plant.assets.unit",
  "plant.outcome",
  "plant.page",
  "plant.quotes.dropped_count",
  "plant.request_id",
];

it("shows made-up data outside production, reading nothing", async () => {
  process.env.VERCEL_ENV = "preview";
  try {
    const page = (await AssetsPage({
      searchParams: Promise.resolve({ tab: "sales" }),
    })) as React.ReactElement<{
      children: React.ReactElement<{ params: unknown }>[];
    }>;
    expect(page.props.children[1]!.props.params).toEqual({ tab: "sales" });
    expect(getSessionClaims).not.toHaveBeenCalled();
    expect(readHoldings).not.toHaveBeenCalled();
  } finally {
    process.env.VERCEL_ENV = "production";
  }
});

it("values in the reference dollar by default", async () => {
  const props = await render();
  expect(props.unit).toBe("usd_ccl");
  expect(props.valuation.kinds.total.value).toBe("150");
  expect(viewLine()).toEqual(
    expect.objectContaining({
      level: "info",
      "enduser.id": USER,
      "plant.page": "/assets",
      "plant.outcome": "ok",
      "plant.assets.holding_count": 2,
      "plant.assets.shown_count": 2,
      "plant.assets.tab": "holdings",
      "plant.assets.asset_class": "all",
      "plant.assets.searched": false,
      "plant.assets.invalid_class": false,
      "plant.assets.invalid_search": false,
      "plant.assets.invalid_tab": false,
      "plant.assets.missing_count": 0,
      "plant.assets.truncated": false,
      "plant.assets.instruments_truncated": false,
      "plant.assets.unit": "usd_ccl",
      "plant.assets.filtered": false,
      "plant.assets.invalid_unit": false,
      "plant.assets.invalid_portfolio": false,
      "plant.quotes.dropped_count": 0,
    }),
  );
});

it("logs exactly the view's fields", async () => {
  await render();
  expect(Object.keys(viewLine()!).sort()).toEqual(VIEW_KEYS);
});

it("reads the quotes active holdings need, from a week back", async () => {
  await render();
  const [range] = read.mock.calls[0] as [
    { from: string; to: string; symbols: string[] },
  ];
  expect(range.symbols).toEqual(["BTC"]);
  expect(range.from < range.to).toBe(true);
});

it("applies ?unit and ?portfolio", async () => {
  const props = await render({ unit: "ars", portfolio: P2 });
  expect(props.unit).toBe("ars");
  expect(props.referenceUnit).toBe("usd_ccl");
  expect(props.filter).toEqual({
    portfolioId: P2,
    assetClass: null,
    search: "",
  });
  expect(props.valuation.kinds.total.value).toBe("62500");
  expect(Object.keys(props.valuation.portfolios)).toEqual([P2]);
  expect(viewLine()).toMatchObject({ "plant.assets.filtered": true });
});

it("opens the tab ?tab names", async () => {
  const props = await render({ tab: "portfolios" });
  expect(Object.keys(props.valuation.portfolios).sort()).toEqual([P1, P2]);
  expect(viewLine()).toMatchObject({ "plant.assets.tab": "portfolios" });
  await render({ tab: "accounts" });
  expect(lines.filter((line) => line.event === "assets.view")[1]).toMatchObject(
    { "plant.assets.tab": "accounts" },
  );
});

it("opens the default view for an old link, without flagging it", async () => {
  const props = await render({ vista: "cuentas", moneda: "ars" });
  expect(props.unit).toBe("usd_ccl");
  expect(viewLine()).toMatchObject({
    "plant.assets.tab": "holdings",
    "plant.assets.invalid_tab": false,
    "plant.assets.invalid_unit": false,
  });
});

it("falls back on invalid params and logs that they were", async () => {
  const props = await render({
    unit: "xyz",
    portfolio: "nope",
    class: "toString",
    tab: "tablero",
    search: "x".repeat(61),
  });
  expect(props.unit).toBe("usd_ccl");
  expect(props.filter).toEqual({
    portfolioId: null,
    assetClass: null,
    search: "",
  });
  expect(viewLine()).toMatchObject({
    "plant.assets.filtered": false,
    "plant.assets.invalid_unit": true,
    "plant.assets.invalid_portfolio": true,
    "plant.assets.invalid_class": true,
    "plant.assets.invalid_search": true,
    "plant.assets.invalid_tab": true,
    "plant.assets.tab": "holdings",
  });
});

it("values only the holdings of ?class matching ?search, and never logs the search", async () => {
  const props = await render({ class: "cash", search: "efectivo" });
  expect(props.filter).toMatchObject({
    assetClass: "cash",
    search: "efectivo",
  });
  expect(Object.keys(props.valuation.values)).toHaveLength(
    Object.keys((await render()).valuation.values).length,
  );
  expect(JSON.stringify(lines)).not.toContain("efectivo");
  expect(viewLine()).toMatchObject({
    "plant.assets.asset_class": "cash",
    "plant.assets.searched": true,
  });
});

it("leaves out the holdings no filter matches", async () => {
  const props = await render({ class: "instrument" });
  expect(props.valuation.values).toEqual({});
  expect(props.valuation.kinds.total.count).toBe(0);
  expect(viewLine()).toMatchObject({
    "plant.assets.holding_count": 2,
    "plant.assets.shown_count": 0,
  });
});

it("does not offer the sales tab, and reads no year", async () => {
  await render({ tab: "sales", year: "2025" });
  expect(viewLine()).toMatchObject({
    "plant.assets.tab": "holdings",
    "plant.assets.invalid_tab": true,
  });
  expect(Object.keys(viewLine()!).sort()).toEqual(VIEW_KEYS);
});

it("logs a failed valuation once and throws it as logged", async () => {
  // A currency no unit holds makes the valuation throw.
  readHoldings.mockResolvedValue(
    list([
      {
        ...holding("h1", P1, "1"),
        holding: { ...holding("h1", P1, "1").holding, currency: "EUR" },
      },
    ]),
  );
  const error: unknown = await render().catch((e: unknown) => e);
  expect(isLoggedError(error)).toBe(true);
  expect(lines).toEqual([
    expect.objectContaining({
      level: "error",
      event: "assets.view",
      "plant.assets.read": "valuation",
    }),
  ]);
});

it("logs a failed quote read once, by its code, and throws it as logged", async () => {
  read.mockRejectedValue(new QuoteStoreError("forbidden", "42501"));
  const error: unknown = await render().catch((e: unknown) => e);
  expect(isLoggedError(error)).toBe(true);
  expect(lines).toEqual([
    expect.objectContaining({
      level: "error",
      event: "assets.view",
      "plant.assets.read": "snapshot",
      "error.type": "forbidden",
      "plant.quotes.store_code": "42501",
    }),
  ]);
});

it("marks the view incomplete when a quote is missing", async () => {
  read.mockResolvedValue({ fxRates: [], prices: [] });
  const props = await render({ unit: "ars" });
  expect(props.valuation.kinds.total.value).toBe("0");
  expect(viewLine()).toMatchObject({
    "plant.outcome": "incomplete",
    "plant.assets.missing_count": 2,
  });
});

it("is incomplete when the holdings list was cut, though every one was valued", async () => {
  readHoldings.mockResolvedValue({
    ...list([holding("h1", P1, "100")]),
    activeTruncated: true,
  });
  await render();
  expect(viewLine()).toMatchObject({
    "plant.outcome": "incomplete",
    "plant.assets.missing_count": 0,
    "plant.assets.truncated": true,
  });
});
