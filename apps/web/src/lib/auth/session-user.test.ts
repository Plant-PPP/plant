import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { initials, sessionChange, toSessionUser } from "./session-user";

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

describe("sessionChange", () => {
  const shown = toSessionUser("ana@x.com");
  const session = (email: string) => ({ user: { email } }) as Session;

  it.each<[AuthChangeEvent, Session | null, ReturnType<typeof sessionChange>]>([
    ["SIGNED_OUT", null, "signed-out"],
    ["SIGNED_IN", session("bruno@x.com"), "switched"],
    ["SIGNED_IN", session("ana@x.com"), null],
    ["TOKEN_REFRESHED", session("bruno@x.com"), null],
    ["INITIAL_SESSION", session("ana@x.com"), null],
  ])("%s as %j -> %s", (event, current, expected) => {
    expect(sessionChange(event, current, shown)).toBe(expected);
  });
});
