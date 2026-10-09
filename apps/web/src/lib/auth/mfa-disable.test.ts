jest.mock("server-only", () => ({}), { virtual: true });

import { captureServerLog } from "@/lib/log/capture-server-log";
import { unenrollForSession } from "./mfa-disable";
import type { AuthClient } from "./mfa-factors";
import { TOTP_FRESH_S } from "./mfa-rules";
import type { SensitiveSession } from "./sensitive-session";

const NOW_S = 1_800_000_000;
const REQUEST_ID = "12345678-aaaa-4bbb-8ccc-dddddddddddd";
const session = { userId: "user-1" } as SensitiveSession;
const fresh = { amr: [{ method: "totp", timestamp: NOW_S - 10 }] };

type Factor = { id: string; status: string };
const factor = (id: string, status = "verified"): Factor => ({ id, status });

function fakeClient({
  user = { id: "user-1", factors: [factor("bound")] as Factor[] },
  getUserError = null as unknown,
  failOn = undefined as string | undefined,
  refreshError = null as unknown,
} = {}) {
  const unenrolled: string[] = [];
  const settledAtBound: string[] = [];
  const auth = {
    getUser: jest.fn(async () =>
      getUserError
        ? { data: { user: null }, error: getUserError }
        : { data: { user }, error: null },
    ),
    refreshSession: jest.fn(async () => ({ error: refreshError })),
    mfa: {
      unenroll: jest.fn(async ({ factorId }: { factorId: string }) => {
        if (factorId === "bound") settledAtBound.push(...unenrolled);
        // Settles on a later tick, so a removal started before the previous
        // one finished would see it unfinished.
        await Promise.resolve();
        if (factorId === failOn) return { data: null, error: new Error("no") };
        unenrolled.push(factorId);
        return { data: {}, error: null };
      }),
    },
  };
  return {
    client: { auth } as unknown as AuthClient,
    auth,
    unenrolled,
    settledAtBound,
  };
}

let lines: Record<string, unknown>[];

beforeEach(() => {
  jest.useFakeTimers({ now: NOW_S * 1000 });
  lines = captureServerLog();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// The one line a call logs. The factor ids the browser can send never reach
// it.
function line(): Record<string, unknown> {
  expect(lines).toHaveLength(1);
  expect(JSON.stringify(lines)).not.toMatch(/bound|other|half|someone-else/);
  expect(lines[0]).toHaveProperty(["enduser.id"], "user-1");
  return lines[0] ?? {};
}

const run = (client: AuthClient, factorId = "bound", claims = fresh) =>
  unenrollForSession({
    session,
    claims,
    client,
    factorId,
    requestId: REQUEST_ID,
  });

it("removes the other factors first and the verified one last", async () => {
  const { client, auth, unenrolled, settledAtBound } = fakeClient({
    user: {
      id: "user-1",
      factors: [factor("bound"), factor("other"), factor("half", "unverified")],
    },
  });
  await expect(run(client)).resolves.toEqual({ outcome: "disabled" });
  expect(unenrolled).toEqual(["other", "bound"]);
  expect(settledAtBound).toEqual(["other"]);
  expect(auth.refreshSession).toHaveBeenCalledTimes(1);
  expect(line()).toMatchObject({
    level: "info",
    event: "auth.mfa.disable",
    "plant.request_id": REQUEST_ID,
    "enduser.id": "user-1",
    "plant.outcome": "disabled",
    "plant.auth.mfa_factors_removed.count": 2,
    "plant.auth.mfa_factors_verified.count": 2,
  });
});

it("refuses a TOTP code older than two minutes without calling Auth", async () => {
  const { client, auth } = fakeClient();
  const stale = {
    amr: [{ method: "totp", timestamp: NOW_S - TOTP_FRESH_S - 1 }],
  };
  await expect(run(client, "bound", stale)).resolves.toEqual({
    outcome: "totp_stale",
  });
  expect(auth.getUser).not.toHaveBeenCalled();
  expect(line()).toMatchObject({
    level: "info",
    "enduser.id": "user-1",
    "plant.outcome": "totp_stale",
  });
});

it("refuses when Auth's user is not the session's", async () => {
  const { client, auth } = fakeClient({
    user: { id: "user-2", factors: [factor("bound")] },
  });
  await expect(run(client)).resolves.toEqual({ outcome: "user_mismatch" });
  expect(auth.mfa.unenroll).not.toHaveBeenCalled();
  expect(line()).toMatchObject({
    level: "warn",
    "plant.outcome": "user_mismatch",
  });
});

it.each([
  ["another user's factor", "someone-else"],
  ["an unverified factor", "half"],
])("removes nothing for %s", async (_, factorId) => {
  const { client, auth } = fakeClient({
    user: {
      id: "user-1",
      factors: [factor("bound"), factor("half", "unverified")],
    },
  });
  await expect(run(client, factorId)).resolves.toEqual({
    outcome: "factor_not_found",
  });
  expect(auth.mfa.unenroll).not.toHaveBeenCalled();
  expect(line()).toMatchObject({
    level: "warn",
    "plant.outcome": "factor_not_found",
    "plant.auth.mfa_factors_removed.count": 0,
    "plant.auth.mfa_factors_verified.count": 1,
  });
});

it("removes nothing when Auth's user has no factors left", async () => {
  const { client, auth } = fakeClient({ user: { id: "user-1" } as never });
  await expect(run(client, "bound")).resolves.toEqual({
    outcome: "factor_not_found",
  });
  expect(auth.mfa.unenroll).not.toHaveBeenCalled();
  expect(line()).toMatchObject({
    "plant.auth.mfa_factors_verified.count": 0,
  });
});

it("reports an ended session apart from an Auth failure", async () => {
  const { client } = fakeClient({
    getUserError: { name: "AuthSessionMissingError" },
  });
  await expect(run(client)).resolves.toEqual({ outcome: "session_ended" });
  expect(line()).toMatchObject({
    level: "info",
    "plant.outcome": "session_ended",
    "error.type": "AuthSessionMissingError",
  });
});

it("logs an Auth failure on getUser as an error", async () => {
  const error = Object.assign(new Error("down"), {
    code: "unexpected_failure",
  });
  const { client, auth } = fakeClient({ getUserError: error });
  await expect(run(client)).resolves.toEqual({ outcome: "error" });
  expect(auth.mfa.unenroll).not.toHaveBeenCalled();
  expect(line()).toMatchObject({
    level: "error",
    "plant.outcome": "error",
    "error.type": "unexpected_failure",
  });
});

it("reports partial when a factor is left behind", async () => {
  const { client, auth } = fakeClient({
    user: { id: "user-1", factors: [factor("bound"), factor("other")] },
    failOn: "bound",
  });
  await expect(run(client)).resolves.toEqual({ outcome: "partial" });
  expect(auth.refreshSession).not.toHaveBeenCalled();
  expect(line()).toMatchObject({
    level: "error",
    "plant.outcome": "partial",
    "exception.message": "no",
    "plant.auth.mfa_factors_removed.count": 1,
    "plant.auth.mfa_factors_verified.count": 2,
  });
});

it("reports an error when the first removal fails", async () => {
  const { client } = fakeClient({ failOn: "bound" });
  await expect(run(client)).resolves.toEqual({ outcome: "error" });
  expect(line()).toMatchObject({
    level: "error",
    "plant.auth.mfa_factors_removed.count": 0,
  });
});

it("says so when every factor is gone but the session did not refresh", async () => {
  const { client } = fakeClient({
    refreshError: Object.assign(new Error("down"), {
      code: "over_request_rate_limit",
    }),
  });
  await expect(run(client)).resolves.toEqual({
    outcome: "session_refresh_failed",
  });
  expect(line()).toMatchObject({
    level: "warn",
    "plant.outcome": "session_refresh_failed",
    "plant.auth.mfa_factors_removed.count": 1,
    "error.type": "over_request_rate_limit",
  });
});
