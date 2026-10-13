jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => null,
}));

import { FileDeletionStoreError } from "./file-deletion-store";
import { ImportStoreError } from "./import-store";
import { fileDeletionSink, importSink } from "./import-sink";

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

it("rejects every file deletion call when there is no secret key", async () => {
  const sink = fileDeletionSink();
  for (const call of [
    () => sink.due(new Date(), 1),
    () => sink.remove(["p"]),
    () => sink.markDeleted(["d1"], new Date()),
  ]) {
    const error = await call().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FileDeletionStoreError);
    expect(error).toMatchObject({ code: "unconfigured" });
  }
});
