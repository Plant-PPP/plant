import { AuthApiError } from "@supabase/supabase-js";

const requestHeaders = new Headers();
const getClaims = jest.fn();
const redirect = jest.fn((url: string) => {
  throw new Error(`redirect ${url}`);
});

jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("next/headers", () => ({ headers: async () => requestHeaders }));
jest.mock("next/navigation", () => ({
  redirect: (url: string) => redirect(url),
}));
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getClaims } }),
}));
jest.mock("react", () => ({ cache: <T>(fn: T) => fn }));

import { getSessionClaims } from "./session-claims";
import { readSessionClaims } from "./session-claims-unchecked";
import { AuthUnavailableError } from "./session-state";

beforeEach(() => {
  requestHeaders.delete("x-plant-auth");
  getClaims.mockReset();
  redirect.mockClear();
});

it.each([
  ["auth_unavailable", "auth_unavailable"],
  ["mfa_claim_missing", "mfa_claim_missing"],
  ["a value it does not know", "auth_unavailable"],
])(
  "throws without refreshing when proxy.ts recorded %s",
  async (value, reason) => {
    requestHeaders.set("x-plant-auth", value);
    const thrown = getSessionClaims();
    await expect(thrown).rejects.toThrow(AuthUnavailableError);
    await expect(thrown).rejects.toMatchObject({ reason });
    expect(getClaims).not.toHaveBeenCalled();
  },
);

it("sends a missing session to /login", async () => {
  getClaims.mockResolvedValue({ data: null, error: null });
  await expect(getSessionClaims()).rejects.toThrow("redirect /login");
});

it("throws on a rate limit instead of signing the user out", async () => {
  const error = new AuthApiError("rate limit", 429, "over_request_rate_limit");
  getClaims.mockResolvedValue({ data: null, error });
  await expect(getSessionClaims()).rejects.toBe(error);
  expect(redirect).not.toHaveBeenCalled();
});

describe("the MFA check", () => {
  function signIn(claims: Record<string, unknown>) {
    getClaims.mockResolvedValue({
      data: { claims: { sub: "u", email: "a@x.com", ...claims } },
      error: null,
    });
  }

  it.each([
    ["without a factor", { aal: "aal1", mfa_enrolled: false }],
    ["verified", { aal: "aal2", mfa_enrolled: true }],
  ])("returns the claims of a user %s", async (_, claims) => {
    signIn(claims);
    await expect(getSessionClaims()).resolves.toMatchObject(claims);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("sends a user with a factor who has not verified it to /auth/mfa", async () => {
    signIn({ aal: "aal1", mfa_enrolled: true });
    await expect(getSessionClaims()).rejects.toThrow("redirect /auth/mfa");
  });

  it("throws instead of returning claims without the MFA claim", async () => {
    signIn({ aal: "aal1" });
    const thrown = getSessionClaims();
    await expect(thrown).rejects.toThrow(AuthUnavailableError);
    await expect(thrown).rejects.toMatchObject({
      reason: "mfa_claim_missing",
    });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("lets /auth/mfa read the claims of a user who has not verified", async () => {
    signIn({ aal: "aal1", mfa_enrolled: true });
    await expect(readSessionClaims()).resolves.toMatchObject({
      mfa_enrolled: true,
    });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("throws on the reader too when the MFA claim is missing", async () => {
    signIn({ aal: "aal1" });
    await expect(readSessionClaims()).rejects.toMatchObject({
      reason: "mfa_claim_missing",
    });
  });
});
