import { holdingSchema } from "@plant/core";

import type { HoldingRow } from "@/lib/holdings/read";

import { breakdownLines } from "./breakdown-lines";

const row = (id: string, account: string): HoldingRow => ({
  id,
  holding: holdingSchema.parse({
    id,
    portfolio_id: "p1",
    asset_class: "cash",
    instrument_symbol: null,
    amount: "1",
    currency: "ARS",
    annual_rate: null,
    started_on: null,
    matures_on: null,
    valued_on: null,
    label: null,
  }),
  account: { id: account, institution: account.toUpperCase() },
  portfolio: { id: "p1", name: "Principal" },
});

describe("breakdownLines", () => {
  const rows = [row("h1", "iol"), row("h2", "balanz"), row("h3", "iol")];
  const values: Record<string, string> = { iol: "10", balanz: "25.5" };

  it("gives each entity one line with its count, largest value first", () => {
    expect(
      breakdownLines(
        rows,
        (each) => each.account,
        (id) => values[id],
      ),
    ).toEqual([
      { id: "balanz", institution: "BALANZ", count: 1 },
      { id: "iol", institution: "IOL", count: 2 },
    ]);
  });

  it("sorts an entity with no value yet as zero", () => {
    expect(
      breakdownLines(
        rows,
        (each) => each.account,
        (id) => (id === "iol" ? "1" : undefined),
      ).map((line) => line.id),
    ).toEqual(["iol", "balanz"]);
  });
});
