const notFound = jest.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
jest.mock("next/navigation", () => ({ notFound: () => notFound() }));
jest.mock("@/components/prototype/prototype-provider", () => ({
  PrototypeProvider: () => null,
}));

import PrototypeLayout from "./layout";

const saved = process.env.VERCEL_ENV;
afterEach(() => {
  notFound.mockClear();
  if (saved === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = saved;
});

it("is not found in production", async () => {
  process.env.VERCEL_ENV = "production";
  await expect(PrototypeLayout({ children: null })).rejects.toThrow(
    "NEXT_NOT_FOUND",
  );
});

it("serves a preview, with the banner and today's snapshot", async () => {
  process.env.VERCEL_ENV = "preview";
  const layout = await PrototypeLayout({ children: null });
  const [banner, provider] = layout.props.children;
  expect(banner.props.children).toBe(
    "Prototipo con datos de prueba. Lo que cambies se pierde al recargar.",
  );
  expect(Object.keys(provider.props.snapshot.prices)).toEqual(
    expect.arrayContaining(["BTC", "AAPL", "AL30"]),
  );
  expect(notFound).not.toHaveBeenCalled();
});
