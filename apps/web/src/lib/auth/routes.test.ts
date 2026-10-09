import { afterLoginPath, isPublicPath, loginPath, mfaPath } from "./routes";

it.each(["/login", "/login/x", "/auth/callback"])("%s is public", (path) => {
  expect(isPublicPath(path)).toBe(true);
});

it.each(["/", "/loginx", "/authx", "/auth/other", "/auth/mfa", "/assets"])(
  "%s needs a session",
  (path) => {
    expect(isPublicPath(path)).toBe(false);
  },
);

it("keeps where the user was going", () => {
  expect(loginPath("/assets?x=1")).toBe("/login?next=%2Fassets%3Fx%3D1");
});

it("drops an unsafe or empty next", () => {
  expect(loginPath("//evil")).toBe("/login");
  expect(loginPath("/")).toBe("/login");
  expect(loginPath()).toBe("/login");
});

it.each([
  "/login",
  "/login?error=callback",
  "/auth/callback",
  "/auth/mfa",
  "/auth/mfa?next=%2Fassets",
  "//evil",
  undefined,
])("lands on / after signing in for %p", (next) => {
  expect(afterLoginPath(next)).toBe("/");
});

it("lands where the user was going", () => {
  expect(afterLoginPath("/assets?x=1")).toBe("/assets?x=1");
});

it("sends an unverified session to the MFA step and back", () => {
  expect(mfaPath("/assets?x=1")).toBe("/auth/mfa?next=%2Fassets%3Fx%3D1");
  expect(mfaPath("/")).toBe("/auth/mfa");
  expect(mfaPath("/auth/mfa")).toBe("/auth/mfa");
});
