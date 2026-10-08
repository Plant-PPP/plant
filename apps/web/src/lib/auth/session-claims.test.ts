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
import { AuthUnavailableError } from "./session-state";

beforeEach(() => {
  requestHeaders.delete("x-plant-auth");
  getClaims.mockReset();
  redirect.mockClear();
});

it("throws without refreshing when proxy.ts found Auth unavailable", async () => {
  requestHeaders.set("x-plant-auth", "unavailable");
  await expect(getSessionClaims()).rejects.toThrow(AuthUnavailableError);
  expect(getClaims).not.toHaveBeenCalled();
});

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

it("returns the claims", async () => {
  const claims = { sub: "u", email: "a@x.com" };
  getClaims.mockResolvedValue({ data: { claims }, error: null });
  await expect(getSessionClaims()).resolves.toBe(claims);
});
