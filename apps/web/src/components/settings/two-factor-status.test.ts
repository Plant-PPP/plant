import type { AuthClient } from "@/lib/auth/mfa-factors";
import { fetchTwoFactorStatus, twoFactorSwitch } from "./two-factor-status";

const client = (listFactors: () => Promise<unknown>) =>
  ({ auth: { mfa: { listFactors } } }) as unknown as AuthClient;

const listed = (statuses: string[]) => async () => ({
  data: {
    all: statuses.map((status, i) => ({ id: `f${i}`, status })),
    totp: [],
  },
  error: null,
});

describe("fetchTwoFactorStatus", () => {
  it("is on with a verified factor", async () => {
    await expect(
      fetchTwoFactorStatus(client(listed(["unverified", "verified"]))),
    ).resolves.toBe("on");
  });

  it("is off with only unverified factors", async () => {
    await expect(
      fetchTwoFactorStatus(client(listed(["unverified"]))),
    ).resolves.toBe("off");
  });

  it("is failed, not off, when the list fails", async () => {
    await expect(
      fetchTwoFactorStatus(
        client(async () => ({ data: null, error: { code: "x" } })),
      ),
    ).resolves.toBe("failed");
    await expect(
      fetchTwoFactorStatus(client(() => Promise.reject(undefined))),
    ).resolves.toBe("failed");
  });
});

describe("twoFactorSwitch", () => {
  it.each([
    ["loading", false, { checked: false, disabled: true }],
    ["failed", false, { checked: false, disabled: true }],
    ["off", false, { checked: false, disabled: false }],
    ["off", true, { checked: true, disabled: true }],
    ["on", false, { checked: true, disabled: true }],
  ] as const)("%s, enrolling %s", (status, enrolling, expected) => {
    expect(twoFactorSwitch(status, enrolling)).toEqual(expected);
  });
});
