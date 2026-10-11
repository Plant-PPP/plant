jest.mock("next/navigation", () => ({ useRouter: () => ({}) }));

import { SALES_TABS, TABS } from "@/lib/holdings/assets-filter";

import { nextTab } from "./assets-tabs";

describe("nextTab", () => {
  it.each([
    ["holdings", "ArrowRight", "accounts"],
    ["portfolios", "ArrowRight", "holdings"],
    ["holdings", "ArrowLeft", "portfolios"],
    ["accounts", "Home", "holdings"],
    ["holdings", "End", "portfolios"],
    ["accounts", "Enter", null],
  ] as const)("from %s, %s goes to %s", (from, key, to) => {
    expect(nextTab(from, key, TABS)).toBe(to);
  });

  it("moves through the tabs the page offers", () => {
    expect(nextTab("portfolios", "ArrowRight", SALES_TABS)).toBe("sales");
    expect(nextTab("holdings", "End", SALES_TABS)).toBe("sales");
    expect(nextTab("sales", "ArrowRight", SALES_TABS)).toBe("holdings");
  });
});
