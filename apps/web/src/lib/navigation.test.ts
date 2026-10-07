import { NAV_ITEMS, navItemForPath, navTitle } from "./navigation";

describe("navItemForPath", () => {
  it("matches the summary only on the exact root", () => {
    expect(navItemForPath("/")?.title).toBe("Resumen");
    expect(navItemForPath("/debts")?.title).toBe("Deudas");
  });

  it("matches nested routes by segment", () => {
    expect(navItemForPath("/assets/123")?.title).toBe("Activos");
  });

  it("does not match a route that only shares a prefix", () => {
    expect(navItemForPath("/assetsx")).toBeUndefined();
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
