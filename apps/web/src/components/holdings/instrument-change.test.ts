import { EMPTY_POSITION, holdingSchema } from "@plant/core";

import type { HoldingRow } from "@/lib/holdings/read";

import {
  applyInstrumentChange,
  type ShownInstrumentHolding,
} from "./instrument-change";

const row = (id: string, amount: string): HoldingRow => ({
  id,
  holding: holdingSchema.parse({
    id,
    portfolio_id: "p1",
    asset_class: "instrument",
    instrument_symbol: "ETH",
    amount,
    currency: null,
    annual_rate: null,
    started_on: null,
    matures_on: null,
    valued_on: null,
    label: null,
  }),
  account: { id: "a1", institution: "IOL" },
  portfolio: { id: "p1", name: "Principal" },
  instrumentType: "crypto",
});

const held = (id: string): ShownInstrumentHolding => ({
  row: row(id, "1"),
  closed: false,
  position: EMPTY_POSITION,
  value: "100",
});

const HOLDINGS = [held("e1"), held("e2")];

it("rewrites the holding a movement touches and marks it unsaved", () => {
  const next = applyInstrumentChange(HOLDINGS, {
    kind: "update",
    row: row("e2", "3"),
  });
  expect(next[0]).toBe(HOLDINGS[0]);
  expect(next[1]).toMatchObject({ unsaved: true });
  expect(next[1]?.row.holding.amount).toBe("3");
  // Again over the refreshed list, the same rows.
  expect(
    applyInstrumentChange(next, { kind: "update", row: row("e2", "3") }),
  ).toEqual(next);
});

it("leaves the list alone for a holding it does not show", () => {
  expect(
    applyInstrumentChange(HOLDINGS, { kind: "update", row: row("x", "1") }),
  ).toEqual(HOLDINGS);
});

it("takes a deleted holding away, once", () => {
  const next = applyInstrumentChange(HOLDINGS, { kind: "delete", id: "e1" });
  expect(next.map((each) => each.row.id)).toEqual(["e2"]);
  expect(applyInstrumentChange(next, { kind: "delete", id: "e1" })).toEqual(
    next,
  );
});

it("changes nothing for no change or a kind the page never sends", () => {
  expect(applyInstrumentChange(HOLDINGS, null)).toBe(HOLDINGS);
  expect(applyInstrumentChange(HOLDINGS, { kind: "archive", id: "e1" })).toBe(
    HOLDINGS,
  );
});
