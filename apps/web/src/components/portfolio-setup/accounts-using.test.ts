import type { SourceConnectionRow } from "@/lib/portfolio-setup/read";
import { accountsUsing, embeds } from "./accounts-using";

const LARGO = { id: "p2", name: "Largo plazo", archived: false };
const LUCIA = { id: "h1", name: "Lucía", archived: false };

const row = (
  id: string,
  institution: string,
  holder: SourceConnectionRow["holder"],
): SourceConnectionRow => ({
  id,
  institution,
  includeInTaxReport: true,
  holder,
  portfolio: LARGO,
});

const ACTIVE = [row("c1", "IOL", null), row("c2", "Balanz", LUCIA)];

describe("accountsUsing", () => {
  it("names the accounts that default to a portfolio", () => {
    expect(accountsUsing(ACTIVE, "portfolio", "p2")).toEqual([
      "tu IOL",
      "Balanz de Lucía",
    ]);
  });

  it("names the accounts of a holder, never the user's own", () => {
    expect(accountsUsing(ACTIVE, "holder", "h1")).toEqual(["Balanz de Lucía"]);
    expect(accountsUsing(ACTIVE, "holder", "p2")).toEqual([]);
  });
});

it("tells whether an account uses a portfolio or holder", () => {
  expect(embeds(ACTIVE[1]!, "holder", "h1")).toBe(true);
  expect(embeds(ACTIVE[0]!, "holder", "h1")).toBe(false);
  expect(embeds(ACTIVE[0]!, "portfolio", "p2")).toBe(true);
});
