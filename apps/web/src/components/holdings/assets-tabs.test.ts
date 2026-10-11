jest.mock("next/navigation", () => ({ useRouter: () => ({}) }));

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
    expect(nextTab(from, key)).toBe(to);
  });
});
