import { createHash } from "node:crypto";

import type { Denominator } from "@plant/core";

import { buildFixtures } from "@/lib/prototype/fixtures";
import { CLOSE_UNITS } from "@/lib/summary/closes";
import * as oracle from "@/lib/summary/closes-oracle.test-support";
import {
  type ClosesState,
  closesOf,
  monthDetail,
  pricedToday,
} from "@/lib/summary/compute";
import { largeLedger } from "./large-ledger.test-support";
import { initialState } from "./prototype-store";

const TODAY = "2026-10-12";
// Building these ledgers and checking them against the oracle takes longer
// than Jest's default timeout.
const SLOW = 60_000;

// JSON with every object's keys sorted, so the order a map was filled in
// does not change the digest.
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_, each: unknown) =>
    each && typeof each === "object" && !Array.isArray(each)
      ? Object.fromEntries(
          Object.entries(each).sort(([a], [b]) => (a < b ? -1 : 1)),
        )
      : each,
  );

// The closes without what they are set against (PLA-67), which the oracle,
// written before it, never computed.
const unbenchmarked = <T>(value: T): T =>
  JSON.parse(
    JSON.stringify(value, (key, each: unknown) =>
      key === "benchmarks" ? undefined : each,
    ),
  ) as T;

function expectOracle(state: ClosesState, units: readonly Denominator[]) {
  expect(pricedToday(state)).toEqual(oracle.pricedToday(state));
  for (const unit of units) {
    const was = oracle.closesOf(state, unit);
    const closes = closesOf(state, unit);
    expect(unbenchmarked(closes)).toEqual(was.closes);
    for (const { period } of closes) {
      expect(unbenchmarked(monthDetail(state, unit, period))).toEqual(
        oracle.monthDetail(state, unit, period, was),
      );
    }
  }
}

it(
  "closes the prototype's months as before",
  () => {
    expectOracle(initialState(buildFixtures(TODAY), TODAY), CLOSE_UNITS);
  },
  SLOW,
);

it(
  "closes a ledger with every kind of movement as before",
  () => {
    expectOracle(largeLedger(TODAY, { count: 1_500, seed: 3 }), [
      "ars",
      "usd_mep",
    ]);
  },
  SLOW,
);

// The closes of 20,000 movements over ten years in every unit and today's
// quotes, as the implementation before PLA-139 computed them.
const LARGE_DIGEST =
  "78dd6dd2437bf93e0e44f6d78a05c43cc939f90e87cf9caea0fd5bca8a013bf4";

it(
  "closes 20,000 movements as before, one unit in a few seconds",
  () => {
    const state = largeLedger(TODAY, { count: 20_000, seed: 7 });
    const started = performance.now();
    closesOf(state, "usd_mep");
    const elapsed = performance.now() - started;
    const closes = CLOSE_UNITS.map((unit) => closesOf(state, unit));
    const digest = createHash("sha256")
      .update(canonical([unbenchmarked(closes), pricedToday(state)]))
      .digest("hex");
    expect(digest).toBe(LARGE_DIGEST);
    expect(elapsed).toBeLessThan(5_000);
  },
  SLOW,
);
