const requestHeaders = new Headers();
const requireSensitiveSession = jest.fn();
const unenrollForSession = jest.fn();
const createClient = jest.fn();
const createServiceRoleClient = jest.fn();
const readLedger = jest.fn();
const readOtherHoldings = jest.fn();
const readLiabilities = jest.fn();
const readImports = jest.fn();

jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("next/headers", () => ({ headers: async () => requestHeaders }));
jest.mock("@/lib/auth/sensitive-session", () => ({
  requireSensitiveSession: (action: string) => requireSensitiveSession(action),
}));
jest.mock("@/lib/auth/session-claims", () => ({
  getSessionClaims: async () => ({ sub: "user-1" }),
}));
jest.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
}));
jest.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => createServiceRoleClient(),
}));
jest.mock("@/lib/ledger/read", () => ({
  readLedger: (...args: unknown[]) => readLedger(...args),
}));
jest.mock("@/lib/export/read", () => ({
  ...jest.requireActual("@/lib/export/read"),
  readOtherHoldings: (...args: unknown[]) => readOtherHoldings(...args),
}));
jest.mock("@/lib/debts/read", () => ({
  readLiabilities: (...args: unknown[]) => readLiabilities(...args),
}));
jest.mock("@/lib/imports/read", () => ({
  readImports: (...args: unknown[]) => readImports(...args),
}));
jest.mock("@/lib/export/tables", () => ({
  exportTables: () => [{ name: "cargas", header: ["Archivo"], rows: [["a"]] }],
}));
jest.mock("@/lib/auth/mfa-disable", () => ({
  ...jest.requireActual("@/lib/auth/mfa-disable"),
  unenrollForSession: (args: unknown) => unenrollForSession(args),
}));

import { captureServerLog } from "@/lib/log/capture-server-log";
import { EXPORT_IMPORTS_LIMIT } from "@/lib/export/read";
import { disableTotp, exportData } from "./actions";

const REQUEST_ID = "12345678-aaaa-4bbb-8ccc-dddddddddddd";

let lines: Record<string, unknown>[];

beforeEach(() => {
  jest.resetAllMocks();
  requestHeaders.set("x-request-id", REQUEST_ID);
  lines = captureServerLog();
});

afterEach(() => jest.restoreAllMocks());

it.each([undefined, 1, { id: "f" }])(
  "refuses %p before the gate and logs it",
  async (factorId) => {
    await expect(disableTotp(factorId)).resolves.toEqual({
      outcome: "invalid_input",
    });
    expect(requireSensitiveSession).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: "warn",
      event: "auth.mfa.disable",
      "plant.request_id": REQUEST_ID,
      "plant.outcome": "invalid_input",
    });
    expect(lines[0]).not.toHaveProperty(["enduser.id"]);
  },
);

it("drops a request id that is not a UUID", async () => {
  requestHeaders.set("x-request-id", "forged");
  await disableTotp(undefined);
  expect(lines[0]).not.toHaveProperty(["plant.request_id"]);
});

it("asks to sign in again when the gate refuses, without calling Auth", async () => {
  requireSensitiveSession.mockResolvedValue({
    ok: false,
    stepUp: "sign_in_again",
  });
  await expect(disableTotp("f")).resolves.toEqual({ stepUp: "sign_in_again" });
  expect(requireSensitiveSession).toHaveBeenCalledWith("disable_mfa");
  expect(createClient).not.toHaveBeenCalled();
  expect(unenrollForSession).not.toHaveBeenCalled();
});

it("hands the gate's proof, the claims and the client to the unenroll", async () => {
  const session = { userId: "user-1" };
  const client = {};
  requireSensitiveSession.mockResolvedValue({ ok: true, session });
  createClient.mockResolvedValue(client);
  unenrollForSession.mockResolvedValue({ outcome: "disabled" });
  await expect(disableTotp("f")).resolves.toEqual({ outcome: "disabled" });
  expect(unenrollForSession).toHaveBeenCalledWith({
    session,
    claims: { sub: "user-1" },
    client,
    factorId: "f",
    requestId: REQUEST_ID,
  });
});

describe("exportData", () => {
  const rpc = jest.fn();

  function readsSucceed({ importsCut = false } = {}) {
    requireSensitiveSession.mockResolvedValue({
      ok: true,
      session: { userId: "user-1" },
    });
    readLedger.mockResolvedValue({ ledger: {}, truncated: false });
    readOtherHoldings.mockResolvedValue({ rows: [], truncated: false });
    readLiabilities.mockResolvedValue({ active: [], activeTruncated: false });
    readImports.mockResolvedValue({
      items: [],
      truncated: importsCut,
      used: 0,
    });
  }

  // Each test starts a fresh minute of the export limiter.
  let clock = 0;
  beforeEach(() => {
    clock += 120_000;
    jest.spyOn(Date, "now").mockReturnValue(clock);
    rpc.mockResolvedValue({ data: null, error: null, status: 204 });
    createClient.mockResolvedValue({});
    createServiceRoleClient.mockReturnValue({ rpc });
  });

  it("asks to sign in again on stale amr claims, reading nothing, and audits the denial", async () => {
    requireSensitiveSession.mockResolvedValue({
      ok: false,
      stepUp: "sign_in_again",
    });
    await expect(exportData()).resolves.toEqual({ stepUp: "sign_in_again" });
    expect(requireSensitiveSession).toHaveBeenCalledWith("export");
    expect(readLedger).not.toHaveBeenCalled();
    expect(readOtherHoldings).not.toHaveBeenCalled();
    expect(readLiabilities).not.toHaveBeenCalled();
    expect(readImports).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("audit_data_export", {
      p_user_id: "user-1",
      p_outcome: "denied",
      p_request_id: REQUEST_ID,
    });
  });

  it("hands over the tables and audits the export after the read", async () => {
    readsSucceed();
    await expect(exportData()).resolves.toEqual({
      tables: [{ name: "cargas", header: ["Archivo"], rows: [["a"]] }],
      truncated: false,
    });
    expect(readImports).toHaveBeenCalledWith(expect.anything(), {
      limit: EXPORT_IMPORTS_LIMIT,
    });
    expect(rpc).toHaveBeenCalledWith("audit_data_export", {
      p_user_id: "user-1",
      p_outcome: "success",
      p_request_id: REQUEST_ID,
    });
    expect(lines.at(-1)).toMatchObject({
      event: "settings.export",
      "plant.outcome": "ok",
      "plant.export.truncated": false,
    });
  });

  it("says the file is partial when the imports were cut", async () => {
    readsSucceed({ importsCut: true });
    await expect(exportData()).resolves.toMatchObject({ truncated: true });
    expect(lines.at(-1)).toMatchObject({ "plant.export.truncated": true });
  });

  it("hands over nothing when the audit row cannot be written", async () => {
    readsSucceed();
    rpc.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "denied" },
      status: 403,
    });
    await expect(exportData()).resolves.toBeNull();
    expect(lines.at(-1)).toMatchObject({
      level: "error",
      event: "settings.export",
      "plant.outcome": "failed",
    });
  });

  it("hands over nothing without the secret key", async () => {
    readsSucceed();
    createServiceRoleClient.mockReturnValue(null);
    await expect(exportData()).resolves.toBeNull();
    expect(lines.at(-1)).toMatchObject({
      level: "error",
      "plant.export.step": "audit",
    });
  });

  it("refuses a sixth export in a minute, reading and auditing nothing", async () => {
    readsSucceed();
    for (let i = 0; i < 5; i += 1) await exportData();
    readLedger.mockClear();
    rpc.mockClear();
    await expect(exportData()).resolves.toEqual({ limited: true });
    expect(requireSensitiveSession).toHaveBeenCalledTimes(5);
    expect(readLedger).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(lines.at(-1)).toMatchObject({
      level: "warn",
      event: "settings.export",
      "plant.outcome": "limited",
    });
  });

  it("audits a failed read", async () => {
    readsSucceed();
    readLedger.mockRejectedValue(new Error("down"));
    await expect(exportData()).resolves.toBeNull();
    expect(rpc).toHaveBeenCalledWith("audit_data_export", {
      p_user_id: "user-1",
      p_outcome: "failure",
      p_request_id: REQUEST_ID,
    });
  });
});
