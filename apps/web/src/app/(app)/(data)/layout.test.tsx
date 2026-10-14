jest.mock("@/components/prototype/prototype-root", () => ({
  PrototypeRoot: () => null,
}));

jest.mock("@/app/(app)/(data)/assets/instrument-actions", () => ({
  addInstrument: jest.fn(),
  searchInstruments: jest.fn(),
}));

import {
  addInstrument,
  searchInstruments,
} from "@/app/(app)/(data)/assets/instrument-actions";
import { InstrumentMarketProvider } from "@/components/holdings/instrument-market";
import { PrototypeRoot } from "@/components/prototype/prototype-root";

import DataLayout from "./layout";

const saved = process.env.VERCEL_ENV;
afterEach(() => {
  if (saved === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = saved;
});

it("renders the pages themselves in production, searching the market", () => {
  process.env.VERCEL_ENV = "production";
  const children = <p>Activos</p>;
  const layout = DataLayout({ children }) as React.ReactElement<{
    market: unknown;
    children: unknown;
  }>;
  expect(layout.type).toBe(InstrumentMarketProvider);
  expect(layout.props.children).toBe(children);
  expect(layout.props.market).toEqual({
    search: searchInstruments,
    add: addInstrument,
  });
});

it("wraps them in the made-up data elsewhere", () => {
  process.env.VERCEL_ENV = "preview";
  const layout = DataLayout({
    children: <p>Activos</p>,
  }) as React.ReactElement;
  expect(layout.type).toBe(PrototypeRoot);
});
