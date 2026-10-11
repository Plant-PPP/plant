jest.mock("next/navigation", () => ({ useRouter: () => ({}) }));

import { searchParamValue, withParam } from "./assets-url";

describe("searchParamValue", () => {
  it("is the search as the URL reads it back", () => {
    expect(searchParamValue("  btc ")).toBe("btc");
    expect(searchParamValue("Crédito Uno")).toBe("Crédito Uno");
    expect(searchParamValue("\uD800a")).toBe("�a");
    expect(searchParamValue("   ")).toBe("");
  });
});

describe("withParam", () => {
  it("sets one param and keeps the others, or drops it", () => {
    const params = { vista: "cuentas", tipo: "cash" };
    expect(withParam(params, "cartera", "p1")).toEqual({
      vista: "cuentas",
      tipo: "cash",
      cartera: "p1",
    });
    expect(withParam(params, "vista", null)).toEqual({ tipo: "cash" });
    expect(params).toEqual({ vista: "cuentas", tipo: "cash" });
  });

  it("applied twice keeps both changes", () => {
    expect(
      withParam(withParam({}, "vista", "cuentas"), "tipo", "cash"),
    ).toEqual({
      vista: "cuentas",
      tipo: "cash",
    });
  });
});

it("takes only the params the page reads", () => {
  // @ts-expect-error: "carteras" is another list's cursor param.
  withParam({}, "carteras", "x");
});
