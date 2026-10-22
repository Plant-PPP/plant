const readLiability = jest.fn();
const read = jest.fn();

jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
jest.mock("@/lib/auth/session-claims", () => ({
  getSessionClaims: async () => ({ sub: "u1" }),
}));
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
jest.mock("@/lib/request-id-server", () => ({
  currentRequestId: async () => undefined,
}));
jest.mock("@/lib/holdings/read", () => ({
  readReferenceDollar: async () => "mep",
  readHoldings: async () => ({ active: [], activeTruncated: false }),
  readInstruments: async () => ({ rows: [], truncated: false }),
}));
jest.mock("@/lib/debts/read", () => ({
  ...jest.requireActual("@/lib/debts/read"),
  readLiability: (...args: unknown[]) => readLiability(...args),
  readLiabilityEvents: async () => ({ byLiability: new Map(), cut: false }),
  readInstallments: async () => ({ byLiability: new Map(), cut: false }),
  readCollateral: async () => [],
  readDisbursement: async () => ({ current: null, options: [] }),
}));
jest.mock("@/lib/quotes/quote-reader", () => ({
  createQuoteReader: () => ({ read }),
}));
jest.mock("@/lib/ledger/read", () => ({
  readManualQuotes: async () => ({
    manualPrices: [],
    manualRates: [],
    truncated: false,
  }),
}));
jest.mock("@/components/debts/debt-history", () => ({
  DebtHistory: () => null,
}));
jest.mock("@/components/prototype/prototype-debt", () => ({
  PrototypeDebt: () => null,
}));

import type * as React from "react";

import { captureServerLog } from "@/lib/log/capture-server-log";
import { nonActionFunctions } from "@/test/client-props";

import * as actions from "../actions";
import DebtPage from "./page";

const ID = "d1000000-0000-4000-8000-0000000000d1";
const saved = process.env.VERCEL_ENV;
beforeAll(() => {
  process.env.VERCEL_ENV = "production";
});
afterAll(() => {
  if (saved === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = saved;
});

const UVA_LOAN = {
  id: ID,
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
  readLiability.mockReset();
  readLiability.mockResolvedValue(UVA_LOAN);
  read.mockResolvedValue({
    fxRates: [{ kind: "mep", rate_date: "2026-10-12", sell: "1250" }],
    prices: [],
  });
});

const open = (id: string) =>
  DebtPage({
    params: Promise.resolve({ id }),
    searchParams: Promise.resolve({}),
  }) as Promise<React.ReactElement>;

it("answers not found for an id that is not a uuid, reading nothing", async () => {
  await expect(open("nope")).rejects.toThrow("NEXT_NOT_FOUND");
  expect(readLiability).not.toHaveBeenCalled();
  expect(lines.at(-1)).toMatchObject({
    event: "liabilities.view",
    "plant.outcome": "not_found",
  });
  expect(lines.at(-1)).not.toHaveProperty("plant.liability.id");
});

it("answers not found, naming the id, for a debt that is not the user's", async () => {
  readLiability.mockResolvedValue(null);
  await expect(open(ID)).rejects.toThrow("NEXT_NOT_FOUND");
  expect(lines.at(-1)).toMatchObject({
    "plant.outcome": "not_found",
    "plant.liability.id": ID,
  });
});

it("logs a debt it could not value as incomplete", async () => {
  await open(ID);
  expect(lines.at(-1)).toMatchObject({
    event: "liabilities.view",
    "plant.outcome": "incomplete",
    "plant.liability.id": ID,
    "plant.liability.missing_count": 1,
    "plant.liability.event_count": 0,
  });
});

it("hands the page only data and server actions", async () => {
  const page = await open(ID);
  expect(nonActionFunctions(page.props, [actions])).toEqual([]);
});
