jest.mock("server-only", () => ({}), { virtual: true });

import { debtsViewOutcome } from "./read";

const valued = (values: (string | null)[]) => ({
  total: "0",
  complete: !values.includes(null),
  items: values.map((value, i) => ({ id: `d${i}`, value, asOf: null })),
});

it("is ok only with every quote, every event and no balance past the limit", () => {
  expect(debtsViewOutcome(valued(["1"]), false, 0)).toEqual({
    "plant.outcome": "ok",
    "plant.liability.events_truncated": false,
    "plant.liability.overflow_count": 0,
    "plant.liability.missing_count": 0,
  });
  expect(debtsViewOutcome(valued(["1"]), true, 0)["plant.outcome"]).toBe(
    "incomplete",
  );
  expect(debtsViewOutcome(valued(["1"]), false, 1)["plant.outcome"]).toBe(
    "incomplete",
  );
  expect(debtsViewOutcome(valued(["1", null]), false, 0)).toMatchObject({
    "plant.outcome": "incomplete",
    "plant.liability.missing_count": 1,
  });
});
