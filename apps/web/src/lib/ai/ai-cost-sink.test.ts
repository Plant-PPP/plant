import { aiCostRow } from "@plant/shared";

jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => null,
}));

import { aiCostSink } from "./ai-cost-sink";
import { AiCostWriteError } from "./ai-cost-writer";

it("rejects every row with missing_key when there is no secret key", async () => {
  const row = aiCostRow(
    "gemini-3.5-flash-lite",
    {
      userId: "a0000000-0000-4000-8000-00000000000a",
      costType: "import_extraction",
    },
    { input: 1, cacheRead: 0, cacheWrite: 0, output: 1 },
  );
  const error = await aiCostSink()(row).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(AiCostWriteError);
  expect(error).toMatchObject({ code: "missing_key", mayHaveCommitted: false });
});
