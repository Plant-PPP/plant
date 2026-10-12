jest.mock("@/components/prototype/prototype-root", () => ({
  PrototypeRoot: () => null,
}));

import { PrototypeRoot } from "@/components/prototype/prototype-root";

import DataLayout from "./layout";

const saved = process.env.VERCEL_ENV;
afterEach(() => {
  if (saved === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = saved;
});

it("renders the pages themselves in production", () => {
  process.env.VERCEL_ENV = "production";
  const children = <p>Activos</p>;
  expect(DataLayout({ children })).toBe(children);
});

it("wraps them in the made-up data elsewhere", () => {
  process.env.VERCEL_ENV = "preview";
  const layout = DataLayout({
    children: <p>Activos</p>,
  }) as React.ReactElement;
  expect(layout.type).toBe(PrototypeRoot);
});
