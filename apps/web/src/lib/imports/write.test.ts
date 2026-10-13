jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/auth/session-claims", () => ({
  getSessionClaims: async () => ({ sub: USER }),
}));
jest.mock("@/lib/request-id-server", () => ({
  currentRequestId: async () => undefined,
}));
const startImport = jest.fn();
jest.mock("@plant/jobs", () => ({
  inngestJobRunner: () => ({ startImport }),
}));

type Answer = {
  data?: unknown;
  error?: unknown;
  status: number;
  count?: number;
};
const answers: Record<string, jest.Mock<Answer, [string]>> = {};
const writes: { table: string; verb: string; body?: unknown }[] = [];
const storage = {
  createSignedUploadUrl: jest.fn(),
  download: jest.fn(),
  remove: jest.fn(),
};
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    storage: { from: () => storage },
    from: (table: string) => {
      let verb = "select";
      const builder = {
        select: () => builder,
        insert: (body: unknown) => {
          verb = "insert";
          writes.push({ table, verb, body });
          return builder;
        },
        delete: () => {
          verb = "delete";
          writes.push({ table, verb });
          return builder;
        },
        eq: () => builder,
        gte: () => builder,
        is: () => builder,
        order: () => builder,
        limit: () => builder,
        then: (resolve: (value: unknown) => unknown) =>
          resolve(answers[table]!(verb)),
      };
      return builder;
    },
  }),
}));

const USER = "a0000000-0000-4000-8000-00000000000a";
const ACCOUNT = "a5000000-0000-4000-8000-0000000000a5";
const UPLOAD = "a9000000-0000-4000-8000-0000000000a9";
const PATH = `${USER}/imports/${UPLOAD}/a7000000-0000-4000-8000-0000000000a7`;

import { createHash } from "node:crypto";

import { captureServerLog } from "@/lib/log/capture-server-log";
import { CONSENT_VERSION } from "@/lib/consent";

import { IMPORTS_PER_MONTH } from "./review";
import { acceptTerms, finishUpload, startUpload } from "./write";

const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n");
const blobOf = (bytes: Uint8Array) => new Blob([new Uint8Array(bytes)]);

let lines: Record<string, unknown>[];
beforeEach(() => {
  lines = captureServerLog();
  writes.length = 0;
  answers.consents = jest.fn((verb) =>
    verb === "insert"
      ? { status: 201, error: null }
      : {
          status: 200,
          data: [{ version: CONSENT_VERSION, granted: true }],
          error: null,
        },
  );
  answers.source_connections = jest.fn<Answer, [string]>(() => ({
    status: 200,
    data: [{ id: ACCOUNT }],
    error: null,
  }));
  answers.uploaded_documents = jest.fn((verb) =>
    verb === "insert"
      ? { status: 201, data: [{ id: "d1" }], error: null }
      : verb === "select"
        ? { status: 200, data: [], error: null }
        : { status: 204, error: null },
  );
  answers.imports = jest.fn<Answer, [string]>((verb) =>
    verb === "insert"
      ? { status: 201, data: [{ id: "i1" }], error: null }
      : { status: 200, count: 0, error: null },
  );
  storage.createSignedUploadUrl
    .mockReset()
    .mockResolvedValue({ data: { token: "t1" }, error: null });
  storage.download
    .mockReset()
    .mockResolvedValue({ data: blobOf(PDF), error: null });
  storage.remove.mockReset().mockResolvedValue({ data: [], error: null });
  startImport.mockReset().mockResolvedValue(undefined);
});

const start = (input: Record<string, unknown> = {}) =>
  startUpload({
    fileName: "Resumen.pdf",
    size: 2048,
    accountId: ACCOUNT,
    ...input,
  });

const finish = (input: Record<string, unknown> = {}) =>
  finishUpload({
    uploadId: UPLOAD,
    path: PATH,
    fileName: "Resumen.pdf",
    accountId: ACCOUNT,
    ...input,
  });

describe("startUpload", () => {
  it("answers a signed URL under the user's folder and a new import", async () => {
    const result = await start();
    expect(result).toMatchObject({
      ok: true,
      token: "t1",
      type: "application/pdf",
    });
    if (!result.ok) throw new Error("refused");
    expect(result.path).toMatch(
      new RegExp(`^${USER}/imports/${result.uploadId}/[0-9a-f-]{36}$`),
    );
    expect(storage.createSignedUploadUrl).toHaveBeenCalledWith(result.path);
    expect(lines.at(-1)).toMatchObject({
      event: "imports.upload",
      "plant.import.step": "start",
      "plant.import.type": "application/pdf",
      "plant.outcome": "ok",
    });
    expect(JSON.stringify(lines)).not.toContain("Resumen");
  });

  it.each([
    [{ fileName: "virus.exe" }, "type"],
    [{ size: 21 * 1024 * 1024 }, "size"],
    [{ size: 0 }, "size"],
    [{ accountId: "a1" }, "invalid"],
    [{ extra: true }, "invalid"],
  ])("refuses %j before asking anything: %s", async (input, code) => {
    expect(await start(input)).toEqual({ ok: false, code });
    expect(storage.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("waits for the terms in force", async () => {
    answers.consents!.mockReturnValue({
      status: 200,
      data: [{ version: "2025-01", granted: true }],
      error: null,
    });
    expect(await start()).toEqual({ ok: false, code: "terms" });
  });

  it("refuses an account the user does not have open", async () => {
    answers.source_connections!.mockReturnValue({
      status: 200,
      data: [],
      error: null,
    });
    expect(await start()).toEqual({ ok: false, code: "not_found" });
  });

  it("refuses once the month's imports are used up", async () => {
    answers.imports!.mockReturnValue({
      status: 200,
      count: IMPORTS_PER_MONTH,
      error: null,
    });
    expect(await start()).toEqual({ ok: false, code: "quota" });
    expect(storage.createSignedUploadUrl).not.toHaveBeenCalled();
    expect(lines.at(-1)).toMatchObject({ "plant.outcome": "quota" });
  });

  it("logs a failure to sign the URL", async () => {
    storage.createSignedUploadUrl.mockResolvedValue({
      data: null,
      error: new Error("boom"),
    });
    expect(await start()).toEqual({ ok: false, code: "failed" });
    expect(lines.at(-1)).toMatchObject({ level: "error" });
  });
});

describe("finishUpload", () => {
  it("files the file with its hash, read back from Storage, and a queued import", async () => {
    expect(await finish({ fileName: "C:\\docs\\Resumen.pdf" })).toEqual({
      ok: true,
      importId: "i1",
    });
    expect(writes).toEqual([
      {
        table: "uploaded_documents",
        verb: "insert",
        body: {
          source_connection_id: ACCOUNT,
          storage_path: PATH,
          file_name: "Resumen.pdf",
          mime_type: "application/pdf",
          size_bytes: PDF.length,
          sha256: createHash("sha256").update(PDF).digest("hex"),
        },
      },
      {
        table: "imports",
        verb: "insert",
        body: { document_id: "d1" },
      },
    ]);
    expect(storage.remove).not.toHaveBeenCalled();
    expect(startImport).toHaveBeenCalledWith({ importId: "i1", userId: USER });
  });

  it("keeps the import queued when its job cannot start", async () => {
    startImport.mockRejectedValue(new Error("no event key"));
    expect(await finish()).toEqual({ ok: true, importId: "i1" });
    expect(lines.at(-1)).toMatchObject({
      level: "error",
      "plant.import.step": "job",
      "plant.outcome": "failed",
    });
  });

  it.each([
    `b0000000-0000-4000-8000-00000000000b/imports/${UPLOAD}/a7000000-0000-4000-8000-0000000000a7`,
    `${USER}/imports/a9000000-0000-4000-8000-0000000000a1/a7000000-0000-4000-8000-0000000000a7`,
  ])("refuses a path that is not the upload's own: %s", async (path) => {
    expect(await finish({ path })).toEqual({ ok: false, code: "invalid" });
    expect(storage.download).not.toHaveBeenCalled();
  });

  it("removes the file when the terms were withdrawn since the start", async () => {
    answers.consents = jest.fn<Answer, [string]>(() => ({
      status: 200,
      data: [],
      error: null,
    }));
    expect(await finish()).toEqual({ ok: false, code: "terms" });
    expect(storage.remove).toHaveBeenCalledWith([PATH]);
    expect(writes).toEqual([]);
  });

  it("removes the file when its account was closed since the start", async () => {
    answers.source_connections = jest.fn<Answer, [string]>(() => ({
      status: 200,
      data: [],
      error: null,
    }));
    expect(await finish()).toEqual({ ok: false, code: "not_found" });
    expect(storage.remove).toHaveBeenCalledWith([PATH]);
    expect(writes).toEqual([]);
  });

  it("answers not found when nothing was uploaded", async () => {
    storage.download.mockResolvedValue({ data: null, error: new Error("404") });
    expect(await finish()).toEqual({ ok: false, code: "not_found" });
  });

  it("removes a file whose bytes are not of the type its name says", async () => {
    storage.download.mockResolvedValue({
      data: blobOf(new TextEncoder().encode("MZ\u0090")),
      error: null,
    });
    expect(await finish()).toEqual({ ok: false, code: "type" });
    expect(storage.remove).toHaveBeenCalledWith([PATH]);
    expect(writes).toEqual([]);
  });

  it("reads again a file whose reading failed, removing the failed one", async () => {
    const EARLIER = `${USER}/imports/a9000000-0000-4000-8000-0000000000b9/f`;
    answers.uploaded_documents = jest.fn((verb) =>
      verb === "select"
        ? {
            status: 200,
            data: [
              {
                id: "d0",
                storage_path: EARLIER,
                imports: { status: "failed" },
              },
            ],
            error: null,
          }
        : verb === "insert"
          ? { status: 201, data: [{ id: "d1" }], error: null }
          : { status: 204, error: null },
    );
    expect(await finish()).toEqual({ ok: true, importId: "i1" });
    expect(writes.map(({ table, verb }) => `${table}:${verb}`)).toEqual([
      "uploaded_documents:delete",
      "uploaded_documents:insert",
      "imports:insert",
    ]);
    expect(storage.remove).toHaveBeenCalledWith([EARLIER]);
  });

  it("keeps a file whose reading did not fail", async () => {
    answers.uploaded_documents = jest.fn((verb) =>
      verb === "select"
        ? {
            status: 200,
            data: [
              { id: "d0", storage_path: "x", imports: { status: "ready" } },
            ],
            error: null,
          }
        : { status: 409, error: { code: "23505" } },
    );
    expect(await finish()).toEqual({ ok: false, code: "duplicate" });
    expect(writes.map(({ verb }) => verb)).not.toContain("delete");
  });

  it("removes a file the account already has", async () => {
    answers.uploaded_documents = jest.fn((verb) =>
      verb === "select"
        ? { status: 200, data: [], error: null }
        : { status: 409, error: { code: "23505" } },
    );
    expect(await finish()).toEqual({ ok: false, code: "duplicate" });
    expect(storage.remove).toHaveBeenCalledWith([PATH]);
  });

  it("takes back the file when its import cannot start", async () => {
    answers.imports!.mockReturnValue({ status: 500, error: { code: "XX000" } });
    expect(await finish()).toEqual({ ok: false, code: "failed" });
    expect(writes.map(({ table, verb }) => `${table}:${verb}`)).toEqual([
      "uploaded_documents:insert",
      "imports:insert",
      "uploaded_documents:delete",
    ]);
    expect(storage.remove).toHaveBeenCalledWith([PATH]);
  });

  it("takes back the file when the database finds the month used up", async () => {
    answers.imports!.mockReturnValue({ status: 429, error: { code: "PT429" } });
    expect(await finish()).toEqual({ ok: false, code: "quota" });
    expect(writes.map(({ table, verb }) => `${table}:${verb}`)).toEqual([
      "uploaded_documents:insert",
      "imports:insert",
      "uploaded_documents:delete",
    ]);
    expect(storage.remove).toHaveBeenCalledWith([PATH]);
    expect(lines.at(-1)).toMatchObject({ "plant.outcome": "quota" });
  });
});

describe("acceptTerms", () => {
  it("accepts the terms, privacy and AI providers in force", async () => {
    expect(await acceptTerms()).toEqual({ ok: true });
    expect(writes).toEqual([
      {
        table: "consents",
        verb: "insert",
        body: ["terms", "privacy", "ai_providers"].map((kind) => ({
          kind,
          version: CONSENT_VERSION,
          granted: true,
        })),
      },
    ]);
  });
});
