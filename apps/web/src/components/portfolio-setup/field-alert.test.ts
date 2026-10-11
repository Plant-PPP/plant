import { choose } from "./field-alert";

describe("choose", () => {
  it("ignores the empty value Radix reports before an option renders", () => {
    const set = jest.fn();
    choose(set)("");
    choose(set)("h1");
    expect(set.mock.calls).toEqual([["h1"]]);
  });
});
