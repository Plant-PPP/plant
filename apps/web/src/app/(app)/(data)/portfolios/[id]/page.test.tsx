const notFound = jest.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
jest.mock("next/navigation", () => ({ notFound: () => notFound() }));
jest.mock("@/components/prototype/prototype-scope", () => ({
  PrototypeScope: () => null,
}));
jest.mock("@/components/prototype/prototype-summary", () => ({
  PrototypeClose: () => null,
}));

import type * as React from "react";

import AccountPage from "../../accounts/[id]/page";
import InstrumentPage from "../../assets/[symbol]/page";
import ClosePage from "../../closes/[period]/page";
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

// These pages have no production version yet.
it.each([
  ["a portfolio", () => PortfolioPage(props("id", "p1"))],
  ["an account", () => AccountPage(props("id", "a1"))],
  ["an instrument", () => InstrumentPage(props("symbol", "btc"))],
  ["a close", () => ClosePage(props("period", "2026-09"))],
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
