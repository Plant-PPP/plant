import type { AuthClient } from "@/lib/auth/mfa-factors";
import {
  CONFIRM_DISABLE_PATH,
  confirmsDisable,
  fetchTwoFactorState,
  twoFactorSwitch,
} from "./two-factor-status";

const client = (listFactors: () => Promise<unknown>) =>
  ({ auth: { mfa: { listFactors } } }) as unknown as AuthClient;

const listed =
  (statuses: string[], totp: { id: string }[] = []) =>
  async () => ({
    data: {
      all: statuses.map((status, i) => ({ id: `f${i}`, status })),
      totp,
    },
    error: null,
  });

describe("fetchTwoFactorState", () => {
  it("is on with a verified factor, naming the TOTP one", async () => {
    await expect(
      fetchTwoFactorState(
        client(listed(["unverified", "verified"], [{ id: "f1" }])),
      ),
    ).resolves.toEqual({ status: "on", totpId: "f1" });
  });

  it("is off with only unverified factors", async () => {
    await expect(
      fetchTwoFactorState(client(listed(["unverified"]))),
    ).resolves.toEqual({ status: "off" });
  });

  it("is failed, not off, when the list fails", async () => {
    await expect(
      fetchTwoFactorState(
        client(async () => ({ data: null, error: { code: "x" } })),
      ),
    ).resolves.toEqual({ status: "failed" });
    await expect(
      fetchTwoFactorState(client(() => Promise.reject(undefined))),
    ).resolves.toEqual({ status: "failed" });
  });
});

describe("twoFactorSwitch", () => {
  const on = { status: "on", totpId: "f" } as const;
  it.each([
    [{ status: "loading" }, "none", { checked: false, disabled: true }],
    [{ status: "failed" }, "none", { checked: false, disabled: true }],
    [{ status: "off" }, "none", { checked: false, disabled: false }],
    [{ status: "off" }, "enroll", { checked: true, disabled: true }],
    [on, "none", { checked: true, disabled: false }],
    [on, "disable", { checked: true, disabled: true }],
    [{ status: "on" }, "none", { checked: true, disabled: true }],
  ] as const)("%p, panel %s", (state, panel, expected) => {
    expect(twoFactorSwitch(state, panel)).toEqual(expected);
  });
});

describe("fetchTwoFactorState with other factors", () => {
  it("names the TOTP factor, not the first verified one", async () => {
    await expect(
      fetchTwoFactorState(
        client(listed(["verified", "verified"], [{ id: "f1" }])),
      ),
    ).resolves.toEqual({ status: "on", totpId: "f1" });
  });

  it("is on without a TOTP factor to turn off", async () => {
    const state = await fetchTwoFactorState(client(listed(["verified"], [])));
    expect(state).toStrictEqual({ status: "on", totpId: undefined });
    expect(twoFactorSwitch(state, "none")).toEqual({
      checked: true,
      disabled: true,
    });
  });
});

describe("confirmsDisable", () => {
  it.each([
    ["confirm=disable", true],
    ["confirm=x&confirm=disable", false],
    ["", false],
  ])("%p: %s", (query, expected) => {
    expect(confirmsDisable(new URLSearchParams(query))).toBe(expected);
  });

  it("is what the step-up comes back to", () => {
    const url = new URL(CONFIRM_DISABLE_PATH, "https://x");
    expect(url.pathname).toBe("/settings");
    expect(confirmsDisable(url.searchParams)).toBe(true);
  });
});
