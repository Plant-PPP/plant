import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { initials, sessionChange, toSessionUser } from "./session-user";

it("names the user after the email's local part", () => {
  const user = toSessionUser("u1", "ana.lopez@x.com");
  expect(user).toEqual({
    id: "u1",
    name: "ana.lopez",
    email: "ana.lopez@x.com",
  });
  expect(initials(user.name)).toBe("AL");
});

it("uses one initial for a one-word name", () => {
  expect(initials(toSessionUser("u1", "a@x.com").name)).toBe("A");
});

it("falls back to the whole email", () => {
  expect(toSessionUser("u1", "@x.com").name).toBe("@x.com");
});

describe("sessionChange", () => {
  const shown = toSessionUser("ana", "ana@x.com");
  const session = (id: string, email = "ana@x.com") =>
    ({ user: { id, email } }) as Session;

  it.each<[AuthChangeEvent, Session | null, ReturnType<typeof sessionChange>]>([
    ["SIGNED_OUT", null, "signed-out"],
    ["SIGNED_IN", session("bruno", "bruno@x.com"), "switched"],
    // Another account that took over the same address.
    ["SIGNED_IN", session("bruno"), "switched"],
    ["SIGNED_IN", session("ana"), null],
    ["TOKEN_REFRESHED", session("bruno"), null],
    ["INITIAL_SESSION", session("ana"), null],
  ])("%s as %j -> %s", (event, current, expected) => {
    expect(sessionChange(event, current, shown)).toBe(expected);
  });
});
