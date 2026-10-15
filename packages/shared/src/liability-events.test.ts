import { CASH_MOVE_GUARD } from "./cash-move";
import { LIABILITY_EVENT_GUARD } from "./liability-events";
import { lastFunctionBodies } from "./testing/migrations";

const raisedBy = (name: RegExp, sqlstate: string): Set<string> =>
  new Set(
    [...lastFunctionBodies(name).values()].flatMap((body) =>
      [
        ...body.matchAll(
          new RegExp(`ERRCODE = '${sqlstate}', HINT = '(\\w+)'`, "g"),
        ),
      ].map(([, hint]) => hint!),
    ),
  );

// The event RPCs also raise a cash move's hints, which CASH_MOVE_GUARD lists.
it("lists exactly the hints the debt guards and event RPCs raise", () => {
  const cash = new Set<string>(CASH_MOVE_GUARD.hints);
  const raised = raisedBy(
    /liability_guard|liability_event_guard|liability_history_guard|record_liability_event|update_liability_event|delete_liability_event/,
    LIABILITY_EVENT_GUARD.sqlstate,
  );
  expect(new Set([...raised].filter((hint) => !cash.has(hint)))).toEqual(
    new Set(LIABILITY_EVENT_GUARD.hints),
  );
});

it("lists exactly the hints a cash move raises", () => {
  expect(raisedBy(/move_cash/, CASH_MOVE_GUARD.sqlstate)).toEqual(
    new Set(CASH_MOVE_GUARD.hints),
  );
});
