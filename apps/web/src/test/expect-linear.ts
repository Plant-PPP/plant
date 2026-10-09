// Times `run` on an input at its size and eight times it. Linear work grows
// eightfold plus garbage collection, which reaches about 20 times on inputs
// that allocate per match (mergeAuthCode's runs of spaces); quadratic work
// grows sixty-fourfold. 32 times splits them, and the 5 ms absorbs timer noise
// on small inputs. Comparing the CPU time of the two keeps the check
// independent of how fast or loaded the machine is. It stops at the first round
// under the bound, or once the larger input takes over a second, so a
// regression fails instead of stalling the suite.
export function expectLinear<T>(
  input: (scale: number) => T,
  run: (input: T) => unknown,
): void {
  const time = (value: T): number => {
    const start = process.cpuUsage();
    run(value);
    const { user, system } = process.cpuUsage(start);
    return (user + system) / 1000;
  };
  const [small, large] = [input(1), input(8)];
  time(small);
  let [bestSmall, bestLarge] = [Infinity, Infinity];
  for (let round = 0; round < 5; round++) {
    bestSmall = Math.min(bestSmall, time(small));
    const elapsed = time(large);
    bestLarge = Math.min(bestLarge, elapsed);
    if (bestLarge < 32 * bestSmall + 5 || elapsed > 1000) break;
  }
  expect(bestLarge).toBeLessThan(32 * bestSmall + 5);
}
