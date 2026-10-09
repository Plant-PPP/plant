import { idSchema, nameInputSchema } from "./schemas";

const schema = nameInputSchema(40);

describe("nameInputSchema", () => {
  test("trims the name", () => {
    expect(schema.parse({ name: "  Largo plazo " })).toEqual({
      name: "Largo plazo",
    });
  });

  test.each(["", "   ", "　"])("refuses a blank name %j", (name) => {
    expect(schema.safeParse({ name }).success).toBe(false);
  });

  test("accepts a name at the limit and refuses one past it", () => {
    expect(schema.safeParse({ name: "a".repeat(40) }).success).toBe(true);
    expect(schema.safeParse({ name: "a".repeat(41) }).success).toBe(false);
  });

  // char_length counts code points, so an emoji is one character.
  test("counts an emoji as one character", () => {
    expect(schema.safeParse({ name: "🌱".repeat(40) }).success).toBe(true);
    expect(schema.safeParse({ name: "🌱".repeat(41) }).success).toBe(false);
  });

  test("normalizes to NFC and single spaces", () => {
    expect(schema.parse({ name: "Jubilacio\u0301n  de\tlargo plazo" })).toEqual(
      {
        name: "Jubilación de largo plazo",
      },
    );
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
    expect(schema.safeParse({ name }).success).toBe(false);
  });

  test.each([
    "👨\u200d👩\u200d👧",
    "\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}",
    "Ahorro ❤\ufe0f",
    "1\ufe0f\u20e3",
    "👍🏽 Largo plazo",
    "🇦🇷",
  ])("keeps the emoji %j", (name) => {
    expect(schema.safeParse({ name }).success).toBe(true);
  });

  test("drops the variation selector after an emoji shown as one", () => {
    expect(schema.parse({ name: "Ahorro \u{1F44D}\ufe0f" })).toEqual({
      name: "Ahorro \u{1F44D}",
    });
    expect(schema.parse({ name: "Ahorro \u2764\ufe0f" })).toEqual({
      name: "Ahorro \u2764\ufe0f",
    });
  });

  test("collapses spaces before counting the limit", () => {
    const name = `${"a".repeat(19)}  ${"a".repeat(20)}`;
    expect(schema.safeParse({ name }).success).toBe(true);
  });

  test("refuses a missing name", () => {
    expect(schema.safeParse({}).success).toBe(false);
  });
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
