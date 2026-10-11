jest.mock("next/navigation", () => ({ useRouter: () => ({}) }));

import { nextTab } from "./assets-tabs";

describe("nextTab", () => {
  it.each([
    ["tenencias", "ArrowRight", "cuentas"],
    ["carteras", "ArrowRight", "tenencias"],
    ["tenencias", "ArrowLeft", "carteras"],
    ["cuentas", "Home", "tenencias"],
    ["tenencias", "End", "carteras"],
    ["cuentas", "Enter", null],
  ] as const)("from %s, %s goes to %s", (from, key, to) => {
    expect(nextTab(from, key)).toBe(to);
  });
});
