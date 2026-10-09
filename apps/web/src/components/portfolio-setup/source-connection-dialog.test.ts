jest.mock("@/app/(app)/accounts/actions", () => ({}));

import type { SourceConnectionRow } from "@/lib/portfolio-setup/read";
import {
  SELF_HOLDER,
  sourceConnectionInputSchema,
} from "@/lib/portfolio-setup/schemas";
import {
  choose,
  holderChoices,
  initialFields,
  missingChoice,
} from "./source-connection-dialog";

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
      holder: SELF_HOLDER,
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
    expect(initialFields(row({ holder: null }), []).holder).toBe(SELF_HOLDER);
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

describe("the dialog's values and the action's schema", () => {
  it("a new account's starting values pass the schema", () => {
    const portfolio = { id: "11111111-1111-4111-8111-111111111111", name: "P" };
    expect(
      sourceConnectionInputSchema(60).safeParse({
        ...initialFields(null, [portfolio]),
        institution: "IOL",
      }).success,
    ).toBe(true);
  });
});

describe("choose", () => {
  it("ignores the empty value Radix reports before an option renders", () => {
    const set = jest.fn();
    choose(set)("");
    choose(set)("h1");
    expect(set.mock.calls).toEqual([["h1"]]);
  });
});

describe("holderChoices", () => {
  const LUCIA = { id: "h1", name: "Lucía" };
  const JUAN = { id: "h2", name: "Juan" };

  it("adds the holders created here after the page's, once", () => {
    expect(holderChoices([LUCIA], [LUCIA, JUAN])).toEqual([LUCIA, JUAN]);
    expect(holderChoices([], [])).toEqual([]);
  });
});
