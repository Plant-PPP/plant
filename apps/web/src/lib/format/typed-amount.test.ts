import { typedAmount } from "./typed-amount";

describe("typedAmount", () => {
  it.each([
    ["30117,=....2ninini", "30117,2"],
    ["1.234.567,89", "1.234.567,89"],
    ["12.5", "12.5"],
    ["US$ 1.000", "1.000"],
    [",5", "5"],
    ["1,2,3", "1,23"],
    ["1,2.3", "1,23"],
    ["-5", "5"],
  ])("keeps %j as %j", (text, kept) => {
    expect(typedAmount(text)).toBe(kept);
  });
});
