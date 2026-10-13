jest.mock("@/app/(app)/(data)/summary-view", () => ({
  SummaryView: () => null,
  CloseView: () => null,
}));
jest.mock("@/components/prototype/prototype-summary", () => ({
  PrototypeSummary: () => null,
  PrototypeClose: () => null,
}));

import type * as React from "react";

import { CloseView, SummaryView } from "@/app/(app)/(data)/summary-view";

import ClosePage from "./closes/[period]/page";
import Home from "./page";

describe("in production", () => {
  const previous = process.env.VERCEL_ENV;
  beforeAll(() => {
    process.env.VERCEL_ENV = "production";
  });
  afterAll(() => {
    if (previous === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = previous;
  });

  it("Resumen reads the user's closes", async () => {
    const page = (await Home({
      searchParams: Promise.resolve({ unit: "ars" }),
    })) as React.ReactElement<{ params: unknown }>;
    expect(page.type).toBe(SummaryView);
    expect(page.props.params).toEqual({ unit: "ars" });
  });

  it("a close's page reads the user's close", async () => {
    const page = (await ClosePage({
      params: Promise.resolve({ period: "2026-09" }),
      searchParams: Promise.resolve({}),
    })) as React.ReactElement<{ period: string }>;
    expect(page.type).toBe(CloseView);
    expect(page.props.period).toBe("2026-09");
  });
});
