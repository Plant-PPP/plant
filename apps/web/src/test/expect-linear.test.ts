import { expectLinear } from "./expect-linear";

const pairs = (n: number): number => {
  let x = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) x ^= i + j;
  return x;
};

it("passes work that grows with its input", () => {
  expectLinear(
    (k) => "ab".repeat(50_000 * k),
    (s) => s.split("").reverse().join(""),
  );
});

it("fails work that grows with the square of its input", () => {
  expect(() => expectLinear((k) => 1500 * k, pairs)).toThrow();
});
