import { expiring } from "./expiring";

it("shares a read until it expires", async () => {
  let at = 0;
  let reads = 0;
  const read = expiring(
    async () => (reads += 1),
    1000,
    () => at,
  );
  expect(await read()).toBe(1);
  at = 999;
  expect(await read()).toBe(1);
  at = 1000;
  expect(await read()).toBe(2);
});

it("reads again after a failed read", async () => {
  let reads = 0;
  const read = expiring(
    async () => {
      reads += 1;
      if (reads === 1) throw new Error("down");
      return reads;
    },
    1000,
    () => 0,
  );
  await expect(read()).rejects.toThrow("down");
  expect(await read()).toBe(2);
});
