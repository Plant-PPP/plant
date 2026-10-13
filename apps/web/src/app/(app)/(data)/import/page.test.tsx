const readImports = jest.fn();
const termsAccepted = jest.fn();

jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("@/lib/auth/session-claims", () => ({
  getSessionClaims: async () => ({ sub: "u1" }),
}));
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
jest.mock("@/lib/request-id-server", () => ({
  currentRequestId: async () => undefined,
}));
jest.mock("@/lib/portfolio-setup/read", () => ({
  ...jest.requireActual("@/lib/portfolio-setup/read"),
  readSourceConnections: async () => ({
    active: [ACCOUNT],
    activeTruncated: false,
    archived: [],
    archivedPage: null,
    archivedFirstHref: null,
    archivedNextHref: null,
  }),
}));
jest.mock("@/lib/imports/read", () => ({
  ...jest.requireActual("@/lib/imports/read"),
  readImports: (...args: unknown[]) => readImports(...args),
}));
jest.mock("@/lib/imports/write", () => ({
  termsAccepted: (...args: unknown[]) => termsAccepted(...args),
}));
jest.mock("@/components/imports/upload-imports", () => ({
  UploadImports: () => null,
}));
jest.mock("@/components/prototype/prototype-imports", () => ({
  PrototypeImports: () => null,
}));

const ACCOUNT = {
  id: "a1",
  institution: "IOL",
  includeInTaxReport: true,
  portfolio: { id: "p1", name: "Principal", archived: false },
};

import type * as React from "react";

import { captureServerLog } from "@/lib/log/capture-server-log";
import { nonActionFunctions } from "@/test/client-props";

import * as actions from "./actions";
import ImportPage from "./page";

const saved = process.env.VERCEL_ENV;
beforeAll(() => {
  process.env.VERCEL_ENV = "production";
});
afterAll(() => {
  if (saved === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = saved;
});

let lines: Record<string, unknown>[];
beforeEach(() => {
  lines = captureServerLog();
  readImports.mockResolvedValue({ items: [], used: 2 });
  termsAccepted.mockResolvedValue(true);
});

type Props = {
  userId: string;
  accounts: unknown[];
  used: number;
  termsAccepted: boolean;
};

it("lists the user's open accounts, imports and whether they took the terms", async () => {
  const page = (await ImportPage()) as React.ReactElement<Props>;
  expect(page.props).toMatchObject({
    userId: "u1",
    accounts: [ACCOUNT],
    used: 2,
    termsAccepted: true,
  });
  expect(lines.at(-1)).toMatchObject({
    event: "imports.view",
    "plant.page": "/import",
    "plant.import.month_count": 2,
    "plant.import.terms_accepted": true,
  });
});

it("hands the page only data and server actions", async () => {
  const page = (await ImportPage()) as React.ReactElement<Props>;
  expect(nonActionFunctions(page.props, [actions])).toEqual([]);
});

it("logs a failed read and shows the error page", async () => {
  readImports.mockRejectedValue(new Error("boom"));
  await expect(ImportPage()).rejects.toThrow("imports.view_failed");
  expect(lines.at(-1)).toMatchObject({
    event: "imports.view",
    "plant.outcome": "error",
  });
});
