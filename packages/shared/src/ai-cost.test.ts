import { aiCostRow } from "./ai-cost";

describe("aiCostRow", () => {
  it("bills the call to the context's user at the requested model's price", () => {
    expect(
      aiCostRow(
        "claude-haiku-4-5",
        {
          userId: "a0000000-0000-4000-8000-00000000000a",
          costType: "import_extraction",
        },
        { input: 1000, cacheRead: 2000, cacheWrite: 400, output: 500 },
      ),
    ).toEqual({
      user_id: "a0000000-0000-4000-8000-00000000000a",
      cost_type: "import_extraction",
      model_id: "claude-haiku-4-5",
      amount_usd: "0.0042",
      input_tokens: 1000,
      cache_read_tokens: 2000,
      cache_write_tokens: 400,
      output_tokens: 500,
    });
  });
});
