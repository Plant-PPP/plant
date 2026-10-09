// Times `run` on an input at its size and four times it: linear work takes
// about four times as long on the larger one, while a pattern that backtracks
// across the input grows sixteenfold and fails the check once it outweighs
// the rest. Comparing the CPU time of the two keeps the check independent of
// how fast or loaded the machine is.
export function expectLinear<T>(
  input: (scale: number) => T,
  run: (input: T) => unknown,
): void {
  const inputs = [input(1), input(4)];
  inputs.forEach((value) => run(value));
  const best = [Infinity, Infinity];
  for (let round = 0; round < 5; round++) {
    inputs.forEach((value, i) => {
      const start = process.cpuUsage();
      run(value);
      const { user, system } = process.cpuUsage(start);
      best[i] = Math.min(best[i]!, (user + system) / 1000);
    });
  }
  expect(best[1]).toBeLessThan(8 * best[0]! + 5);
}
