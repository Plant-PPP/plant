import { NAME_LIMITS } from "./limits";
import { normalizeName } from "./normalize-name";
import {
  idSchema,
  portfolioInputSchema,
  sourceConnectionInputSchema,
} from "./schemas";

const MAX = NAME_LIMITS.portfolios.name;

describe("portfolioInputSchema", () => {
  test("trims the name", () => {
    expect(portfolioInputSchema.parse({ name: "  Largo plazo " })).toEqual({
      name: "Largo plazo",
    });
  });

  test.each(["", "   ", "　"])("refuses a blank name %j", (name) => {
    expect(portfolioInputSchema.safeParse({ name }).success).toBe(false);
  });

  test("accepts a name at the limit and refuses one past it", () => {
    expect(
      portfolioInputSchema.safeParse({ name: "a".repeat(MAX) }).success,
    ).toBe(true);
    expect(
      portfolioInputSchema.safeParse({ name: "a".repeat(MAX + 1) }).success,
    ).toBe(false);
  });

  // char_length counts code points, so an emoji is one character.
  test("counts an emoji as one character", () => {
    expect(
      portfolioInputSchema.safeParse({ name: "🌱".repeat(MAX) }).success,
    ).toBe(true);
    expect(
      portfolioInputSchema.safeParse({ name: "🌱".repeat(MAX + 1) }).success,
    ).toBe(false);
  });

  test("normalizes to NFC and single spaces", () => {
    expect(
      portfolioInputSchema.parse({ name: "Jubilacio\u0301n  de\tlargo plazo" }),
    ).toEqual({
      name: "Jubilación de largo plazo",
    });
  });

  test.each([
    "\u0000x",
    "\ud800",
    "a\u0007b",
    "a\u202eb",
    "Trading\u200b",
    "Principal\u00ad",
    "a\u200eb",
    "\u3164",
    "\u200d",
    "\u0301",
    "a\u061cb",
    "Principal\u200d",
    "Principal\ufe0f",
    "Principal\u034f",
    "Principal\u{e0100}",
    "Principal\u{e0061}",
    "a\u200cb",
    "\u{1D159}",
    "Principal\u{1D159}",
    "Principal\u{16FE4}",
  ])("refuses %j", (name) => {
    expect(portfolioInputSchema.safeParse({ name }).success).toBe(false);
  });

  test.each([
    "👨\u200d👩\u200d👧",
    "\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}",
    "Ahorro ❤\ufe0f",
    "1\ufe0f\u20e3",
    "👍🏽 Largo plazo",
    "🇦🇷",
  ])("keeps the emoji %j", (name) => {
    expect(portfolioInputSchema.safeParse({ name }).success).toBe(true);
  });

  test("drops the variation selector after an emoji shown as one", () => {
    expect(
      portfolioInputSchema.parse({ name: "Ahorro \u{1F44D}\ufe0f" }),
    ).toEqual({
      name: "Ahorro \u{1F44D}",
    });
    expect(
      portfolioInputSchema.parse({ name: "Ahorro \u{1F44D}\ufe0f\ufe0f" }),
    ).toEqual({
      name: "Ahorro \u{1F44D}",
    });
    expect(portfolioInputSchema.parse({ name: "Ahorro \u2764\ufe0f" })).toEqual(
      {
        name: "Ahorro \u2764\ufe0f",
      },
    );
  });

  test("refuses a huge name without scanning it", () => {
    expect(
      portfolioInputSchema.safeParse({ name: "a".repeat(1_000_000) }).success,
    ).toBe(false);
    expect(
      portfolioInputSchema.safeParse({ name: `a${" ".repeat(300)}b` }).success,
    ).toBe(true);
  });

  test("collapses spaces before counting the limit", () => {
    const name = `${"a".repeat(19)}  ${"a".repeat(20)}`;
    expect(portfolioInputSchema.safeParse({ name }).success).toBe(true);
  });

  test("refuses a missing name", () => {
    expect(portfolioInputSchema.safeParse({}).success).toBe(false);
  });
});

test("normalizeName gives the name the schema stores", () => {
  expect(normalizeName(" Mi  cartera ")).toBe("Mi cartera");
  expect(normalizeName("Jubilacio\u0301n")).toBe("Jubilación");
});

describe("idSchema", () => {
  test("accepts a uuid and refuses anything else", () => {
    expect(
      idSchema.safeParse("6f1c2b1e-3c4d-4e5f-8a9b-0c1d2e3f4a5b").success,
    ).toBe(true);
    expect(idSchema.safeParse("1").success).toBe(false);
    expect(idSchema.safeParse("eq.1").success).toBe(false);
  });
});

describe("sourceConnectionInputSchema", () => {
  const PORTFOLIO = "22222222-2222-4222-8222-222222222222";
  const valid = {
    institution: " Bull  Market ",
    includeInTaxReport: true,
    defaultPortfolioId: PORTFOLIO,
  };

  test("normalizes the institution like a name", () => {
    expect(sourceConnectionInputSchema.parse(valid)).toEqual({
      ...valid,
      institution: "Bull Market",
    });
  });

  test("accepts an institution at the limit", () => {
    const institution = "a".repeat(NAME_LIMITS.source_connections.institution);
    expect(
      sourceConnectionInputSchema.parse({ ...valid, institution }).institution,
    ).toBe(institution);
  });

  test("drops a field it does not know", () => {
    expect(
      sourceConnectionInputSchema.parse({ ...valid, holder: "self" }),
    ).not.toHaveProperty("holder");
  });

  test.each([
    ["no portfolio", { defaultPortfolioId: undefined }],
    ["a portfolio that is not an id", { defaultPortfolioId: "Principal" }],
    ["a text flag", { includeInTaxReport: "true" }],
    [
      "an institution past the limit",
      {
        institution: "a".repeat(NAME_LIMITS.source_connections.institution + 1),
      },
    ],
    ["a blank institution", { institution: " " }],
  ])("refuses %s", (_, change) => {
    expect(
      sourceConnectionInputSchema.safeParse({ ...valid, ...change }).success,
    ).toBe(false);
  });
});
