jest.mock("server-only", () => ({}), { virtual: true });
const notFound = jest.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
jest.mock("next/navigation", () => ({ notFound: () => notFound() }));
jest.mock("@/components/prototype/prototype-scope", () => ({
  PrototypeScope: () => null,
}));
jest.mock("@/components/prototype/prototype-imports", () => ({
  PrototypeImportReview: () => null,
}));

import type * as React from "react";

import AccountPage from "../../accounts/[id]/page";
import InstrumentPage from "../../assets/[symbol]/page";
import ImportReviewPage from "../../import/[id]/page";
import PortfolioPage from "./page";

const saved = process.env.VERCEL_ENV;
afterEach(() => {
  if (saved === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = saved;
});

const props = (key: string, value: string) => ({
  params: Promise.resolve({ [key]: value }) as never,
  searchParams: Promise.resolve({}),
});

// An import's review has no production version yet.
it("is not found in production for an import's review", async () => {
  process.env.VERCEL_ENV = "production";
  await expect(
    ImportReviewPage({ params: Promise.resolve({ id: "i1" }) }),
  ).rejects.toThrow("NEXT_NOT_FOUND");
});

it.each([
  ["a portfolio", () => PortfolioPage(props("id", "p1")), "portfolio"],
  ["an account", () => AccountPage(props("id", "a1")), "account"],
])("shows made-up data elsewhere for %s", async (_, render, kind) => {
  process.env.VERCEL_ENV = "preview";
  const page = (await render()) as React.ReactElement<{
    kind: string;
    id: string;
  }>;
  expect(page.props).toMatchObject({ kind });
});

it("passes the instrument's symbol upper-cased elsewhere", async () => {
  process.env.VERCEL_ENV = "preview";
  const page = (await InstrumentPage(
    props("symbol", "btc"),
  )) as React.ReactElement<{ symbol: string }>;
  expect(page.props.symbol).toBe("BTC");
});
