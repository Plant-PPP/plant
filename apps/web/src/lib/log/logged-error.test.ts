import { isLoggedError, LoggedError } from "./logged-error";

test("isLoggedError matches by name", () => {
  expect(isLoggedError(new LoggedError("x"))).toBe(true);
  expect(
    isLoggedError(Object.assign(new Error("x"), { name: "LoggedError" })),
  ).toBe(true);
  expect(isLoggedError(new Error("x"))).toBe(false);
  expect(isLoggedError({ name: "LoggedError" })).toBe(false);
});
