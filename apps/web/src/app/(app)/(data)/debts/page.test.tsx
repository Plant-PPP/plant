const readLiabilities = jest.fn();
const read = jest.fn();

jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("@/lib/auth/session-claims", () => ({
  getSessionClaims: async () => ({ sub: "u1" }),
}));
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
jest.mock("@/lib/request-id-server", () => ({
  currentRequestId: async () => undefined,
}));
jest.mock("@/lib/holdings/read", () => ({
  readReferenceDollar: async () => "mep",
  readInstruments: async () => ({ rows: [], truncated: false }),
}));
jest.mock("@/lib/debts/read", () => ({
  ...jest.requireActual("@/lib/debts/read"),
  readLiabilities: (...args: unknown[]) => readLiabilities(...args),
  readLiabilityEvents: async () => ({ byLiability: new Map(), cut: false }),
}));
jest.mock("@/lib/quotes/quote-reader", () => ({
  createQuoteReader: () => ({ read }),
}));
const manual = { manualPrices: [] as unknown[], manualRates: [] as unknown[] };
jest.mock("@/lib/ledger/read", () => ({
  readManualQuotes: async () => ({ ...manual, truncated: false }),
}));
jest.mock("@/components/debts/debts-setup", () => ({
  DebtsSetup: () => null,
}));
jest.mock("@/components/prototype/prototype-debts", () => ({
  PrototypeDebts: () => null,
}));

import type { LiabilitiesValue } from "@plant/core";
import type * as React from "react";

import { captureServerLog } from "@/lib/log/capture-server-log";
import { nonActionFunctions } from "@/test/client-props";

import * as actions from "./actions";
import DebtsPage from "./page";

const saved = process.env.VERCEL_ENV;
beforeAll(() => {
  process.env.VERCEL_ENV = "production";
});
afterAll(() => {
  if (saved === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = saved;
});

const UVA_LOAN = {
  id: "d1",
  kind: "mortgage",
  label: "Hipoteca",
  lender: null,
  currency: "ARS",
  uva: true,
  instrument_symbol: null,
  balance: "100",
  installment: null,
  annual_rate: null,
  installments_left: null,
  next_due_on: null,
  matures_on: null,
  accrues: false,
  opened_on: null,
  anchored_on: "2026-01-01",
};

let lines: Record<string, unknown>[];
beforeEach(() => {
  lines = captureServerLog();
  readLiabilities.mockResolvedValue({
    active: [UVA_LOAN],
    activeTruncated: false,
    archived: [],
    archivedPage: null,
    archivedFirstHref: null,
    archivedNextHref: null,
  });
  read.mockResolvedValue({
    fxRates: [
      { kind: "uva", rate_date: "2026-10-12", sell: "1600" },
      { kind: "mep", rate_date: "2026-10-12", sell: "1250" },
    ],
    prices: [],
  });
});

type Props = { valued: LiabilitiesValue; unit: string; referenceUnit: string };

const render = async (params: Record<string, string> = {}) => {
  const page = (await DebtsPage({
    searchParams: Promise.resolve(params),
  })) as React.ReactElement<{ children: React.ReactElement<Props>[] }>;
  return page.props.children[1]!.props;
};

it("values a UVA debt at the day's UVA in the reference dollar", async () => {
  const props = await render();
  expect(props.unit).toBe("usd_mep");
  // 100 UVA × 1600 = 160000 pesos, at 1250 a dollar.
  expect(props.valued.total).toBe("128");
  expect(read).toHaveBeenCalledWith(
    expect.objectContaining({ fxKinds: expect.arrayContaining(["uva"]) }),
  );
  expect(lines.at(-1)).toMatchObject({
    event: "liabilities.view",
    "plant.outcome": "ok",
    "plant.liability.count": 1,
  });
  expect(JSON.stringify(lines)).not.toContain("128");
});

it("values in the unit ?unit names", async () => {
  const props = await render({ unit: "ars" });
  expect(props.unit).toBe("ars");
  expect(props.valued.total).toBe("160000");
});

it("values with the user's manual dollar rate, as Resumen does", async () => {
  manual.manualRates = [{ kind: "mep", rate_date: "2026-10-12", sell: "1600" }];
  try {
    // 160000 pesos at the user's 1600 a dollar.
    expect((await render()).valued.total).toBe("100");
  } finally {
    manual.manualRates = [];
  }
});

it("hands the page only data and server actions", async () => {
  expect(nonActionFunctions(await render(), [actions])).toEqual([]);
});

it("shows made-up debts outside production, reading nothing", async () => {
  process.env.VERCEL_ENV = "preview";
  readLiabilities.mockClear();
  await DebtsPage({ searchParams: Promise.resolve({}) });
  expect(readLiabilities).not.toHaveBeenCalled();
  process.env.VERCEL_ENV = "production";
});
