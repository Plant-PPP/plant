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
  ])("refuses %j", (name) => {
    expect(schema.safeParse({ name }).success).toBe(false);
  });

  test("keeps emoji joined by ZWJ or built from tags", () => {
    expect(schema.safeParse({ name: "👨‍👩‍👧" }).success).toBe(true);
    expect(schema.safeParse({ name: "🏴󠁧󠁢󠁳󠁣󠁴󠁿" }).success).toBe(true);
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
