import { NAV_ITEMS, routeItemForPath, navTitle } from "./navigation";

describe("routeItemForPath", () => {
  it("matches the summary only on the exact root", () => {
    expect(routeItemForPath("/")?.title).toBe("Resumen");
    expect(routeItemForPath("/debts")?.title).toBe("Deudas");
  });

  it("matches nested routes by segment", () => {
    expect(routeItemForPath("/assets/123")?.title).toBe("Activos");
  });

  it("does not match a route that only shares a prefix", () => {
    expect(routeItemForPath("/assetsx")).toBeUndefined();
  });
});

describe("navTitle", () => {
  it("returns the label for a route", () => {
    expect(navTitle("/import")).toBe("Cargar");
  });
});

it("has a single primary item", () => {
  expect(NAV_ITEMS.filter((item) => item.primary)).toHaveLength(1);
});

it("finds Ajustes, which is not in the sidebar", () => {
  expect(routeItemForPath("/settings")?.title).toBe("Ajustes");
  expect(navTitle("/settings")).toBe("Ajustes");
  expect(NAV_ITEMS.map((item) => item.href)).not.toContain("/settings");
});

it("takes only a known route", () => {
  // @ts-expect-error not a route
  expect(() => navTitle("/nowhere")).toThrow();
});
