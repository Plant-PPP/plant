const readLedger = jest.fn();
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
  readReferenceDollar: async () => "ccl",
}));
jest.mock("@/lib/ledger/read", () => ({
  ...jest.requireActual("@/lib/ledger/read"),
  readLedger: (...args: unknown[]) => readLedger(...args),
}));
jest.mock("@/lib/quotes/quote-reader", () => ({
  createQuoteReader: () => ({ read }),
}));
jest.mock("@/components/holdings/instrument-history", () => ({
  InstrumentHistory: () => null,
}));

import type * as React from "react";

import { writeOperation } from "@/lib/ledger/ledger";
import {
  emptyLedger,
  PURCHASE,
} from "@/lib/ledger/ledger-fixture.test-support";

import * as holdingActions from "@/app/(app)/(data)/assets/actions";
import * as movementActions from "@/app/(app)/(data)/assets/movement-actions";
import { nonActionFunctions } from "@/test/client-props";

import InstrumentPage from "./page";

const saved = process.env.VERCEL_ENV;
beforeAll(() => {
  process.env.VERCEL_ENV = "production";
});
afterAll(() => {
  if (saved === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = saved;
});

const bought = writeOperation(emptyLedger(), PURCHASE, {
  operationId: "op",
  newId: () => crypto.randomUUID(),
}).state;

beforeEach(() => {
  readLedger.mockResolvedValue({
    ledger: bought,
    truncated: false,
    symbolOf: new Map(),
  });
  read.mockResolvedValue({ fxRates: [], prices: [] });
});

const render = (symbol: string, query: Record<string, string> = {}) =>
  InstrumentPage({
    params: Promise.resolve({ symbol }),
    searchParams: Promise.resolve(query),
  }) as Promise<
    React.ReactElement<{
      holdings: unknown[];
      unit: string;
      referenceUnit: string;
    }>
  >;

it("shows the history of an instrument the user holds, in the reference dollar", async () => {
  const page = await render("aapl");
  expect(page.props.holdings).toHaveLength(2);
  expect(page.props.unit).toBe("usd_ccl");
  expect((await render("aapl", { unit: "ars" })).props.unit).toBe("ars");
});

it("hands the history only data and server actions", async () => {
  const page = await render("aapl");
  expect(
    nonActionFunctions(page.props, [holdingActions, movementActions]),
  ).toEqual([]);
});

it("shows an instrument the user holds nothing of empty, and has no page for one that does not exist", async () => {
  readLedger.mockResolvedValue({
    ledger: emptyLedger(),
    truncated: false,
    symbolOf: new Map(),
  });
  expect((await render("aapl")).props.holdings).toEqual([]);
  await expect(render("nope")).rejects.toThrow("NEXT_NOT_FOUND");
});
