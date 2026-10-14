import type { SourceConnectionRow } from "@/lib/portfolio-setup/read";
import { sourceConnectionInputSchema } from "@/lib/portfolio-setup/schemas";
import {
  accountRow,
  initialFields,
  offeredPortfolio,
} from "./source-connection-dialog";

const PRINCIPAL = { id: "p1", name: "Principal" };
const LARGO = { id: "p2", name: "Largo plazo" };

const row = (
  change: Partial<SourceConnectionRow> = {},
): SourceConnectionRow => ({
  id: "c1",
  institution: "IOL",
  includeInTaxReport: false,
  portfolio: { id: "p2", name: "Largo plazo", archived: false },
  ...change,
});

describe("initialFields", () => {
  it("starts a new account in the oldest portfolio, in the report", () => {
    expect(initialFields(null, [LARGO, PRINCIPAL])).toEqual({
      institution: "",
      includeInTaxReport: true,
      defaultPortfolioId: "p1",
      website: null,
      icon: null,
    });
  });

  it("leaves the portfolio unselected when there is none", () => {
    expect(initialFields(null, []).defaultPortfolioId).toBe("");
  });

  it("starts from the account's values", () => {
    expect(initialFields(row(), [LARGO, PRINCIPAL])).toEqual({
      institution: "IOL",
      includeInTaxReport: false,
      defaultPortfolioId: "p2",
      website: null,
      icon: null,
    });
  });

  it("keeps an archived portfolio for the dialog to unchoose", () => {
    const archived = row({
      portfolio: { id: "p3", name: "Vieja", archived: true },
    });
    expect(initialFields(archived, [PRINCIPAL]).defaultPortfolioId).toBe("p3");
  });
});

describe("offeredPortfolio", () => {
  it("is the portfolio the page offers", () => {
    expect(offeredPortfolio([PRINCIPAL, LARGO], "p2")).toBe(LARGO);
  });

  it("is nothing for a portfolio the page no longer offers, or none chosen", () => {
    expect(offeredPortfolio([PRINCIPAL], "p3")).toBeUndefined();
    expect(offeredPortfolio([PRINCIPAL], "")).toBeUndefined();
  });
});

describe("the dialog's values and the action's schema", () => {
  it("a new account's starting values pass the schema", () => {
    const portfolio = { id: "11111111-1111-4111-8111-111111111111", name: "P" };
    expect(
      sourceConnectionInputSchema.safeParse({
        ...initialFields(null, [portfolio]),
        institution: "IOL",
      }).success,
    ).toBe(true);
  });
});

describe("accountRow", () => {
  it("is the row its fields describe, with the chosen portfolio", () => {
    expect(
      accountRow(
        "c9",
        {
          institution: "  Banco   Uno ",
          includeInTaxReport: false,
          defaultPortfolioId: "p2",
          website: "https://bancouno.com.ar/",
          icon: "data:image/png;base64,iVBORw0KGgo=",
        },
        { id: "p2", name: "Largo plazo" },
      ),
    ).toEqual({
      id: "c9",
      institution: "Banco Uno",
      includeInTaxReport: false,
      portfolio: { id: "p2", name: "Largo plazo", archived: false },
      website: "https://bancouno.com.ar/",
      icon: "data:image/png;base64,iVBORw0KGgo=",
    });
  });
});
