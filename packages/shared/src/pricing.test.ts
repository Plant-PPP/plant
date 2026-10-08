import { decimalStringSchema } from "./money";
import { MODEL_PRICING, costUsd, type PricedModelId } from "./pricing";

const none = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };

describe("MODEL_PRICING", () => {
  it.each(Object.entries(MODEL_PRICING))(
    "prices %s with decimal strings",
    (_modelId, prices) => {
      for (const price of Object.values(prices)) {
        expect(decimalStringSchema.safeParse(price).success).toBe(true);
      }
    },
  );
});

describe("costUsd", () => {
  it("prices input and output tokens", () => {
    // 4,000 × 0.30 / 1M + 3,000 × 2.50 / 1M = 0.0012 + 0.0075
    expect(
      costUsd("gemini-3.5-flash-lite", { ...none, input: 4000, output: 3000 }),
    ).toBe("0.0087");
  });

  it("prices all four buckets", () => {
    // 1,000 × 1.00 + 2,000 × 0.10 + 400 × 1.25 + 500 × 5.00 = 4,200 per 1M
    expect(
      costUsd("claude-haiku-4-5", {
        input: 1000,
        cacheRead: 2000,
        cacheWrite: 400,
        output: 500,
      }),
    ).toBe("0.0042");
  });

  it("returns 0 for no tokens", () => {
    expect(costUsd("gemini-3.8-flash", none)).toBe("0");
  });

  it("keeps a single token exact", () => {
    expect(costUsd("gemini-3.1-flash-lite", { ...none, input: 1 })).toBe(
      "0.00000025",
    );
    expect(costUsd("gemini-3.5-flash-lite", { ...none, cacheRead: 1 })).toBe(
      "0.00000003",
    );
  });

  it("rounds half up to 8 decimals", () => {
    // 1 × 0.025 / 1M = 0.000000025
    expect(costUsd("gemini-3.1-flash-lite", { ...none, cacheRead: 1 })).toBe(
      "0.00000003",
    );
  });

  it("stays a valid decimal string at the largest token counts", () => {
    const max = Number.MAX_SAFE_INTEGER;
    const cost = costUsd("gemini-3.8-flash", {
      input: max,
      cacheRead: max,
      cacheWrite: max,
      output: max,
    });
    expect(decimalStringSchema.safeParse(cost).success).toBe(true);
  });

  it.each(Object.keys(MODEL_PRICING) as PricedModelId[])(
    "returns a decimal string for %s",
    (modelId) => {
      const cost = costUsd(modelId, {
        input: 123_456,
        cacheRead: 7_890,
        cacheWrite: 1_234,
        output: 56_789,
      });
      expect(decimalStringSchema.safeParse(cost).success).toBe(true);
    },
  );

  it.each([
    ["negative", -1],
    ["fractional", 1.5],
    ["unsafe", Number.MAX_SAFE_INTEGER + 1],
    ["NaN", Number.NaN],
  ])("rejects a %s token count without echoing it", (_label, count) => {
    expect(() =>
      costUsd("gemini-3.5-flash-lite", { ...none, output: count }),
    ).toThrow(
      new RangeError("Token counts must be non-negative safe integers"),
    );
  });
});
