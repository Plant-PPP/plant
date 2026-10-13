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
jest.mock("@/app/(app)/(data)/import/review-view", () => ({
  ImportReviewView: () => null,
}));

import type * as React from "react";

import { ImportReviewView } from "@/app/(app)/(data)/import/review-view";

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

it("reviews the user's import in production", async () => {
  process.env.VERCEL_ENV = "production";
  const page = (await ImportReviewPage({
    params: Promise.resolve({ id: "i1" }),
  })) as React.ReactElement<{ id: string }>;
  expect(page.type).toBe(ImportReviewView);
  expect(page.props.id).toBe("i1");
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
