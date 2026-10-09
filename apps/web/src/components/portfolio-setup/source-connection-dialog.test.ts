jest.mock("@/app/(app)/accounts/actions", () => ({}));

import type { SourceConnectionRow } from "@/lib/portfolio-setup/read";
import { initialFields, missingChoice } from "./source-connection-dialog";

const PRINCIPAL = { id: "p1", name: "Principal" };
const LARGO = { id: "p2", name: "Largo plazo" };

const row = (
  change: Partial<SourceConnectionRow> = {},
): SourceConnectionRow => ({
  id: "c1",
  institution: "IOL",
  includeInTaxReport: false,
  holder: { id: "h1", name: "Lucía", archived: false },
  portfolio: { id: "p2", name: "Largo plazo", archived: false },
  ...change,
});

describe("initialFields", () => {
  it("starts a new account as the user's, in the oldest portfolio, in the report", () => {
    expect(initialFields(null, [LARGO, PRINCIPAL])).toEqual({
      institution: "",
      holder: "self",
      includeInTaxReport: true,
      defaultPortfolioId: "p1",
    });
  });

  it("leaves the portfolio unselected when there is none", () => {
    expect(initialFields(null, []).defaultPortfolioId).toBe("");
  });

  it("starts from the account's values", () => {
    expect(initialFields(row(), [LARGO, PRINCIPAL])).toEqual({
      institution: "IOL",
      holder: "h1",
      includeInTaxReport: false,
      defaultPortfolioId: "p2",
    });
    expect(initialFields(row({ holder: null }), []).holder).toBe("self");
  });

  it("leaves an archived holder or portfolio unselected", () => {
    const archived = row({
      holder: { id: "h1", name: "Lucía", archived: true },
      portfolio: { id: "p3", name: "Vieja", archived: true },
    });
    expect(initialFields(archived, [PRINCIPAL])).toMatchObject({
      holder: "",
      defaultPortfolioId: "",
    });
  });
});

describe("missingChoice", () => {
  const fields = initialFields(row(), []);

  it("is nothing once both selects are chosen", () => {
    expect(missingChoice(fields)).toBeUndefined();
  });

  it("names the holder, then the portfolio", () => {
    expect(
      missingChoice({ ...fields, holder: "", defaultPortfolioId: "" }),
    ).toBe("holder");
    expect(missingChoice({ ...fields, defaultPortfolioId: "" })).toBe(
      "portfolio",
    );
  });
});
