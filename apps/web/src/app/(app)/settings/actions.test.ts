const requestHeaders = new Headers();
const requireSensitiveSession = jest.fn();
const unenrollForSession = jest.fn();
const createClient = jest.fn();

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
jest.mock("@/lib/auth/mfa-disable", () => ({
  ...jest.requireActual("@/lib/auth/mfa-disable"),
  unenrollForSession: (args: unknown) => unenrollForSession(args),
}));

import { captureServerLog } from "@/lib/log/capture-server-log";
import { disableTotp } from "./actions";

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
