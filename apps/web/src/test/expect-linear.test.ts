import { expectLinear } from "./expect-linear";

// Each run advances a fake CPU clock by cost(n) ms, so the arithmetic is tested
// apart from the machine.
function fakeCpu(cost: (n: number) => number): (n: number) => void {
  let now = 0;
  jest
    .spyOn(process, "cpuUsage")
    .mockImplementation((prev?: NodeJS.CpuUsage) => ({
      user: now - (prev?.user ?? 0),
      system: 0,
    }));
  return (n) => {
    now += cost(n) * 1000;
  };
}

afterEach(() => jest.restoreAllMocks());

it("passes work that grows with its input", () => {
  expectLinear(
    (k) => 10 * k,
    fakeCpu((n) => n),
  );
});

it("fails work that grows with the square of its input", () => {
  expect(() =>
    expectLinear(
      (k) => 10 * k,
      fakeCpu((n) => (n * n) / 10),
    ),
  ).toThrow();
});

it("gives up after a large run over a second", () => {
  const run = jest.fn(fakeCpu((n) => (n * n) / 10));
  expect(() => expectLinear((k) => 40 * k, run)).toThrow();
  expect(run).toHaveBeenCalledTimes(3);
});
