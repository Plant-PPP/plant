import type { SourceConnectionRow } from "@/lib/portfolio-setup/read";
import { accountsUsing } from "./accounts-using";

const row = (
  id: string,
  institution: string,
  portfolio: string,
): SourceConnectionRow => ({
  id,
  institution,
  includeInTaxReport: true,
  portfolio: { id: portfolio, name: portfolio, archived: false },
});

const ACTIVE = [
  row("c1", "IOL", "p2"),
  row("c2", "Balanz", "p2"),
  row("c3", "Cocos", "p1"),
];

describe("accountsUsing", () => {
  it("names the accounts that default to a portfolio", () => {
    expect(accountsUsing(ACTIVE, "p2")).toEqual(["IOL", "Balanz"]);
    expect(accountsUsing(ACTIVE, "p1")).toEqual(["Cocos"]);
    expect(accountsUsing(ACTIVE, "p3")).toEqual([]);
  });
});
