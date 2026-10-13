const readImportForReview = jest.fn();
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
  readReferenceDollar: async () => "mep",
}));
jest.mock("@/lib/ledger/read", () => ({
  ...jest.requireActual("@/lib/ledger/read"),
  readLedger: async () => ({
    ledger: LEDGER,
    truncated: false,
    symbolOf: new Map(),
  }),
}));
jest.mock("@/lib/imports/read", () => ({
  ...jest.requireActual("@/lib/imports/read"),
  readImportForReview: (...args: unknown[]) => readImportForReview(...args),
}));
jest.mock("@/components/imports/import-review", () => ({
  ImportReview: () => null,
}));

import type * as React from "react";

import {
  ACCOUNT,
  emptyLedger,
  PORTFOLIO,
} from "@/lib/ledger/ledger-fixture.test-support";
import { captureServerLog } from "@/lib/log/capture-server-log";
import { nonActionFunctions } from "@/test/client-props";

import * as actions from "./actions";
import { ImportReviewView } from "./review-view";

const LEDGER = emptyLedger();
const ID = "a9000000-0000-4000-8000-0000000000a9";

const ITEM = {
  id: ID,
  fileName: "resumen.pdf",
  accountId: ACCOUNT,
  status: "ready",
  error: null,
  documentDate: "2026-09-30",
  documentTotals: [],
  rows: [],
  createdOn: "2026-10-12",
};

let lines: Record<string, unknown>[];
beforeEach(() => {
  lines = captureServerLog();
  notFound.mockClear();
  readImportForReview.mockResolvedValue(ITEM);
});

type Props = {
  institution: string;
  routing: { defaultPortfolioId: string };
};

it("reviews a ready import against its account", async () => {
  const page = (await ImportReviewView({
    id: ID,
  })) as React.ReactElement<Props>;
  expect(page.props.institution).toBe("IOL");
  expect(page.props.routing.defaultPortfolioId).toBe(PORTFOLIO);
  expect(nonActionFunctions(page.props, [actions])).toEqual([]);
  expect(lines.at(-1)).toMatchObject({
    event: "imports.view",
    "plant.outcome": "ok",
  });
});

it.each([
  ["an id that is not one", "i1", ITEM],
  ["an import that is not the user's", ID, null],
  ["one not ready to review", ID, { ...ITEM, status: "confirmed" }],
])("has no page for %s", async (_, id, item) => {
  readImportForReview.mockResolvedValue(item);
  await expect(ImportReviewView({ id })).rejects.toThrow("NEXT_NOT_FOUND");
});
