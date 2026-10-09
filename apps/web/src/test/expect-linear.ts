// Times `run` on an input at its size and eight times it. Linear work grows
// about eightfold, give or take allocation and garbage collection, while
// quadratic work grows sixty-fourfold, so 24 times splits them with room for
// both; the 5 ms absorbs timer noise on small inputs. Comparing the CPU time of
// the two keeps the check independent of how fast or loaded the machine is.
export function expectLinear<T>(
  input: (scale: number) => T,
  run: (input: T) => unknown,
): void {
  const inputs = [input(1), input(8)];
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
  expect(best[1]).toBeLessThan(24 * best[0]! + 5);
}
