import { aiCostRow } from "@plant/shared";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

jest.mock("server-only", () => ({}), { virtual: true });
let mockClient: SupabaseClient | null = null;
jest.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => mockClient,
}));

import { aiCostSink } from "./ai-cost-sink";
import { AiCostWriteError } from "./ai-cost-writer";

const row = aiCostRow(
  "gemini-3.5-flash-lite",
  {
    userId: "a0000000-0000-4000-8000-00000000000a",
    costType: "import_extraction",
  },
  { input: 1, cacheRead: 0, cacheWrite: 0, output: 1 },
);

it("rejects every row with missing_key when there is no secret key", async () => {
  mockClient = null;
  const error = await aiCostSink()(row).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(AiCostWriteError);
  expect(error).toMatchObject({ code: "missing_key", mayHaveCommitted: false });
});

it("writes the row with the service-role client", async () => {
  const fetch = jest.fn(async () => new Response(null, { status: 201 }));
  mockClient = createClient("http://127.0.0.1:54321", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch },
  });
  await expect(aiCostSink()(row)).resolves.toBeUndefined();
  expect(fetch).toHaveBeenCalledWith(
    "http://127.0.0.1:54321/rest/v1/ai_costs",
    expect.objectContaining({ method: "POST" }),
  );
});
