import { reportLimiter } from "./limit";

it("lets each sender log 20 a minute, saying once that it drops the rest", () => {
  let now = 0;
  const limit = reportLimiter({ now: () => now });
  const verdicts = Array.from({ length: 22 }, () => limit("a"));
  expect(verdicts.slice(0, 20).every((each) => each === "logged")).toBe(true);
  expect(verdicts.slice(20)).toEqual(["dropped_first", "dropped"]);
  expect(limit("b")).toBe("logged");
  now = 60_000;
  expect(limit("a")).toBe("logged");
});

it("caps the instance however many senders there are", () => {
  const limit = reportLimiter({ now: () => 0 });
  const verdicts = Array.from({ length: 301 }, (_, i) => limit(`s${i}`));
  expect(verdicts.filter((each) => each === "logged")).toHaveLength(300);
});

it("does not let one flooding sender silence another", () => {
  const limit = reportLimiter({ now: () => 0 });
  for (let i = 0; i < 1_000; i += 1) limit("flood");
  expect(limit("honest")).toBe("logged");
});

it("keeps a bounded number of senders, counting the rest as one", () => {
  const limit = reportLimiter({
    now: () => 0,
    perSender: 2,
    perInstance: 1_000,
    maxSenders: 3,
  });
  for (const sender of ["a", "b", "c"]) limit(sender);
  // Past the bound, new senders share one count: the third of them drops
  // though each sent once.
  expect(["d", "e", "f"].map((sender) => limit(sender))).toEqual([
    "logged",
    "logged",
    "dropped_first",
  ]);
});
