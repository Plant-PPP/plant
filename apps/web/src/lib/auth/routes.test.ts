import { isPublicPath, loginPath } from "./routes";

it.each(["/login", "/login/x", "/auth/callback"])("%s is public", (path) => {
  expect(isPublicPath(path)).toBe(true);
});

it.each(["/", "/loginx", "/authx", "/assets"])("%s needs a session", (path) => {
  expect(isPublicPath(path)).toBe(false);
});

it("keeps where the user was going", () => {
  expect(loginPath("/assets?x=1")).toBe("/login?next=%2Fassets%3Fx%3D1");
});

it("drops an unsafe or empty next", () => {
  expect(loginPath("//evil")).toBe("/login");
  expect(loginPath("/")).toBe("/login");
  expect(loginPath()).toBe("/login");
});
