jest.mock("@/components/prototype/prototype-provider", () => ({
  PrototypeProvider: () => null,
}));

import { PrototypeRoot } from "./prototype-root";

it("renders the banner and today's snapshot", async () => {
  const root = await PrototypeRoot({ children: null });
  const [banner, provider] = root.props.children;
  expect(banner.props.children).toBe(
    "Datos de prueba. Lo que cambies se pierde al recargar.",
  );
  expect(Object.keys(provider.props.snapshot.prices)).toEqual(
    expect.arrayContaining(["BTC", "AAPL", "SPY"]),
  );
});
