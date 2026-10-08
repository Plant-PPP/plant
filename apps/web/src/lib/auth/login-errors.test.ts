import {
  LOGIN_ERROR_SLUGS,
  authErrorSlug,
  loginErrorMessage,
  loginErrorPath,
} from "./login-errors";

it("has copy for every slug", () => {
  for (const slug of LOGIN_ERROR_SLUGS) {
    expect(loginErrorMessage(slug)).toEqual(expect.any(String));
  }
});

it.each([
  "constructor",
  "toString",
  "__proto__",
  "hasOwnProperty",
  "<b>x</b>",
  ["callback"],
  undefined,
])("shows nothing for %p", (slug) => {
  expect(loginErrorMessage(slug)).toBeUndefined();
});

it("builds the login URL for a slug", () => {
  expect(loginErrorPath("callback")).toBe("/login?error=callback");
});

it.each([
  ["email_address_invalid", "invalid_email"],
  ["email_address_not_authorized", "not_authorized"],
  ["over_email_send_rate_limit", "rate_limited"],
  ["over_request_rate_limit", "rate_limited"],
  ["otp_expired", "invalid_code"],
  ["unexpected_failure", "generic"],
  [undefined, "generic"],
])("maps Auth's %p to %p", (code, slug) => {
  expect(authErrorSlug({ code })).toBe(slug);
});
