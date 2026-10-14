jest.mock("server-only", () => ({}), { virtual: true });

import { emptyLedger } from "@/lib/ledger/ledger-fixture.test-support";

import { syncGainAlerts } from "./read";

const row = (id: string) => ({
  id,
  subject_kind: "instrument",
  subject: "BTC",
  direction: "above",
  threshold: "1.00000000",
  currency: "USD",
  gain_percent: "10.0000",
  cost_price: "1.00000000",
  met_on: null,
  met_price: null,
  seen_at: null,
});

// A client whose select answers the waiting gain alerts and whose updates
// answer each status in turn, recording the ids they touched.
function client(alerts: unknown[], updates: number[]) {
  const updated: string[] = [];
  const chain = (result: unknown) => {
    const step: Record<string, unknown> = {};
    for (const name of ["select", "not", "is", "limit", "update"]) {
      step[name] = () => step;
    }
    step.eq = (_column: string, id: string) => {
      updated.push(id);
      return step;
    };
    step.then = (resolve: (value: unknown) => void) =>
      resolve(typeof result === "function" ? result() : result);
    return step;
  };
  let selected = false;
  return {
    updated,
    from: () =>
      chain(() => {
        if (!selected) {
          selected = true;
          return { data: alerts, error: null, status: 200 };
        }
        const status = updates.shift() ?? 204;
        return {
          data: null,
          error: status === 204 ? null : { code: "23514" },
          status,
        };
      }),
  };
}

it("leaves every figure as it was when the ledger was cut short", async () => {
  const fake = client([row("a")], []);
  const load = jest.fn(async () => ({
    ledger: emptyLedger(),
    truncated: true,
  }));
  expect(await syncGainAlerts(fake as never, load)).toBe(0);
  expect(load).toHaveBeenCalledTimes(1);
  expect(fake.updated).toEqual([]);
});

it("works the others out when the table refuses one alert's figure", async () => {
  // No holdings: each alert's figure goes back to none, and the first
  // update is refused.
  const fake = client([row("a"), row("b")], [400, 204]);
  const load = async () => ({ ledger: emptyLedger(), truncated: false });
  expect(await syncGainAlerts(fake as never, load)).toBe(1);
  expect(fake.updated).toEqual(["a", "b"]);
});

it("reads no ledger when the user has no gain alert", async () => {
  const load = jest.fn();
  expect(await syncGainAlerts(client([], []) as never, load)).toBe(0);
  expect(load).not.toHaveBeenCalled();
});
