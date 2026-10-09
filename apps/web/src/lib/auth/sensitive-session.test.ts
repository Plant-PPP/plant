const requestHeaders = new Headers();
const getSessionClaims = jest.fn();

jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("next/headers", () => ({ headers: async () => requestHeaders }));
jest.mock("./session-claims", () => ({
  getSessionClaims: () => getSessionClaims(),
}));

import { captureServerLog } from "@/lib/log/capture-server-log";
import { needsStepUp, requireSensitiveSession } from "./sensitive-session";

const NOW_S = 1_800_000_000;
const REQUEST_ID = "12345678-aaaa-4bbb-8ccc-dddddddddddd";

let lines: Record<string, unknown>[];

beforeEach(() => {
  jest.useFakeTimers({ now: NOW_S * 1000 + 999 });
  requestHeaders.set("x-request-id", REQUEST_ID);
  getSessionClaims.mockReset();
  lines = captureServerLog();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

function signedInAt(timestamp: number, method = "otp") {
  getSessionClaims.mockResolvedValue({
    sub: "user-1",
    aal: "aal1",
    mfa_enrolled: false,
    amr: [{ method, timestamp }],
  });
}

it("lets a sign-in from the last 15 minutes through, with only the user id", async () => {
  signedInAt(NOW_S - 900);
  await expect(requireSensitiveSession("export")).resolves.toEqual({
    ok: true,
    session: { userId: "user-1" },
  });
  expect(lines).toEqual([]);
});

it("asks for a new sign-in after 15 minutes and logs it once", async () => {
  signedInAt(NOW_S - 901);
  await expect(requireSensitiveSession("delete_account")).resolves.toEqual({
    ok: false,
    stepUp: "sign_in_again",
  });
  expect(lines).toHaveLength(1);
  const line = lines[0];
  expect(line).toMatchObject({
    level: "info",
    event: "auth.step_up",
    "plant.request_id": REQUEST_ID,
    "enduser.id": "user-1",
    "plant.outcome": "step_up_required",
    "plant.auth.sensitive_action": "delete_account",
  });
  expect(JSON.stringify(line)).not.toMatch(/amr|aal|otp|timestamp/);
});

it("does not count a verified TOTP code as the sign-in", async () => {
  signedInAt(NOW_S, "totp");
  await expect(requireSensitiveSession("change_email")).resolves.toEqual({
    ok: false,
    stepUp: "sign_in_again",
  });
});

it("drops a request id that is not a UUID", async () => {
  requestHeaders.set("x-request-id", "forged");
  signedInAt(NOW_S - 901);
  await requireSensitiveSession("export");
  expect(lines[0]).not.toHaveProperty(["plant.request_id"]);
});

it("lets the session check's redirect or error through", async () => {
  const thrown = new Error("redirect /auth/mfa");
  getSessionClaims.mockRejectedValue(thrown);
  await expect(requireSensitiveSession("export")).rejects.toBe(thrown);
  expect(lines).toEqual([]);
});

it("logs a denied MFA turn-off under its own action", async () => {
  signedInAt(NOW_S - 901);
  await requireSensitiveSession("disable_mfa");
  expect(lines[0]).toMatchObject({
    "plant.auth.sensitive_action": "disable_mfa",
  });
});

describe("needsStepUp", () => {
  it("is false within the window and true past it, logging nothing", async () => {
    signedInAt(NOW_S - 900);
    await expect(needsStepUp()).resolves.toBe(false);
    signedInAt(NOW_S - 901);
    await expect(needsStepUp()).resolves.toBe(true);
    expect(lines).toEqual([]);
  });
});
