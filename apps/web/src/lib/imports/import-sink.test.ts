jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => null,
}));

import { FileDeletionStoreError } from "./file-deletion-store";
import { ImportStoreError } from "./import-store";
import { ColumnMappingsError } from "./column-mappings-store";
import {
  columnMappingsSink,
  fileDeletionSink,
  importSink,
  orphanFileSink,
} from "./import-sink";
import { OrphanFileStoreError } from "./orphan-file-store";

it("rejects every call when there is no secret key", async () => {
  const sink = importSink();
  for (const call of [
    () => sink.load("i1", "u1"),
    () => sink.download("u1/imports/p", "u1"),
    () => sink.reading("i1", "u1"),
    () => sink.institution("i1", "u1"),
    () => sink.failed("i1", "u1", "unreadable"),
  ]) {
    const error = await call().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ImportStoreError);
    expect(error).toMatchObject({ code: "unconfigured" });
  }
});

it("rejects every column mapping call when there is no secret key", async () => {
  const sink = columnMappingsSink();
  for (const call of [
    () => sink.get("u1", "IOL", ["Especie"]),
    () => sink.save("u1", "IOL", ["Especie"], {}),
  ]) {
    const error = await call().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ColumnMappingsError);
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

it("rejects every orphan file call when there is no secret key", async () => {
  const sink = orphanFileSink();
  for (const call of [() => sink.orphans(1, null), () => sink.remove(["p"])]) {
    const error = await call().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OrphanFileStoreError);
    expect(error).toMatchObject({ code: "unconfigured" });
  }
});
