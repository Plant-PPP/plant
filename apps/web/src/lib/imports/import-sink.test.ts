jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => null,
}));

import { ImportStoreError } from "./import-store";
import { importSink } from "./import-sink";

it("rejects every call when there is no secret key", async () => {
  const sink = importSink();
  for (const call of [
    () => sink.load("i1"),
    () => sink.download("p"),
    () => sink.reading("i1"),
    () => sink.failed("i1", "unreadable"),
  ]) {
    const error = await call().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ImportStoreError);
    expect(error).toMatchObject({ code: "unconfigured" });
  }
});
