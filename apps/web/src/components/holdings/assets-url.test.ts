jest.mock("next/navigation", () => ({ useRouter: () => ({}) }));

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { SALES_TABS } from "@/lib/holdings/assets-filter";

import {
  answeredInPlace,
  searchParamValue,
  useAssetsUrl,
  withParam,
} from "./assets-url";

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

it("reports no page loading before any change", () => {
  let pending: boolean | undefined;
  function Probe() {
    ({ pending } = useAssetsUrl({ tab: "accounts" }));
    return null;
  }
  renderToStaticMarkup(createElement(Probe));
  expect(pending).toBe(false);
});

describe("answeredInPlace", () => {
  const rendered = { unit: "ars", search: "btc" };
  const inPlace = (next: Record<string, string>) =>
    answeredInPlace(rendered, next, SALES_TABS);

  it("applies a filter, a search or a tab over the holdings the page has", () => {
    expect(inPlace({ unit: "ars", search: "eth" })).toBe(true);
    expect(inPlace({ unit: "ars", search: "btc", class: "cash" })).toBe(true);
    expect(inPlace({ unit: "ars", search: "btc", tab: "accounts" })).toBe(true);
  });

  it("asks the server for another unit or sales year", () => {
    expect(inPlace({ search: "btc" })).toBe(false);
    expect(inPlace({ unit: "ars", search: "btc", year: "2025" })).toBe(false);
  });

  it("asks the server for the sales of a filter it did not render", () => {
    expect(inPlace({ unit: "ars", search: "btc", tab: "sales" })).toBe(true);
    expect(inPlace({ unit: "ars", search: "eth", tab: "sales" })).toBe(false);
  });
});
