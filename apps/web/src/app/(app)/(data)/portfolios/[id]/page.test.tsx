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
jest.mock("@/components/prototype/prototype-summary", () => ({
  PrototypeClose: () => null,
}));

import type * as React from "react";

import AccountPage from "../../accounts/[id]/page";
import InstrumentPage from "../../assets/[symbol]/page";
import ClosePage from "../../closes/[period]/page";
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

// These pages read movements, which only the made-up data has so far.
it.each([
  ["a portfolio", () => PortfolioPage(props("id", "p1"))],
  ["an account", () => AccountPage(props("id", "a1"))],
  ["an instrument", () => InstrumentPage(props("symbol", "btc"))],
  ["a close", () => ClosePage(props("period", "2026-09"))],
  [
    "an import's review",
    () => ImportReviewPage({ params: Promise.resolve({ id: "i1" }) }),
  ],
])("is not found in production for %s", async (_, render) => {
  process.env.VERCEL_ENV = "production";
  await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
});

it("passes the instrument's symbol upper-cased elsewhere", async () => {
  process.env.VERCEL_ENV = "preview";
  const page = (await InstrumentPage(
    props("symbol", "btc"),
  )) as React.ReactElement<{ symbol: string }>;
  expect(page.props.symbol).toBe("BTC");
});
