import { initials, toSessionUser } from "./session-user";

it("names the user after the email's local part", () => {
  const user = toSessionUser("ana.lopez@x.com");
  expect(user).toEqual({ name: "ana.lopez", email: "ana.lopez@x.com" });
  expect(initials(user.name)).toBe("AL");
});

it("uses one initial for a one-word name", () => {
  expect(initials(toSessionUser("a@x.com").name)).toBe("A");
});

it("falls back to the whole email", () => {
  expect(toSessionUser("@x.com").name).toBe("@x.com");
});
