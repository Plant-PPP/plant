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
    const params = { tab: "accounts", class: "cash" };
    expect(withParam(params, "portfolio", "p1")).toEqual({
      tab: "accounts",
      class: "cash",
      portfolio: "p1",
    });
    expect(withParam(params, "tab", null)).toEqual({ class: "cash" });
    expect(params).toEqual({ tab: "accounts", class: "cash" });
  });

  it("applied twice keeps both changes", () => {
    expect(
      withParam(withParam({}, "tab", "accounts"), "class", "cash"),
    ).toEqual({
      tab: "accounts",
      class: "cash",
    });
  });
});

it("takes only the params the page reads", () => {
  // @ts-expect-error: "holdings" is the archived holdings' cursor param.
  withParam({}, "holdings", "x");
  // @ts-expect-error: "portfolios" is another list's cursor param.
  withParam({}, "portfolios", "x");
});
