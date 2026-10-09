import { AuthApiError, AuthSessionMissingError } from "@supabase/supabase-js";
import { signOutEverywhere } from "./sign-out-everywhere-steps";

type Auth = Parameters<typeof signOutEverywhere>[0];

const auth = (othersError: unknown, userError: unknown = null) =>
  ({
    getUser: jest.fn(async () => ({ data: { user: null }, error: userError })),
    signOut: jest.fn(async () => ({ error: othersError })),
    getSession: jest.fn(),
  }) as unknown as Auth & { signOut: jest.Mock };

it("signs out the other devices, then this one", async () => {
  const client = auth(null);
  const here = jest.fn(async () => true);
  await expect(signOutEverywhere(client, here)).resolves.toBe("done");
  expect(client.signOut).toHaveBeenCalledWith({ scope: "others" });
  expect(here).toHaveBeenCalledWith(client);
});

it("keeps this session when the other devices could not be signed out", async () => {
  const here = jest.fn();
  await expect(signOutEverywhere(auth(new Error("x")), here)).resolves.toBe(
    "others_failed",
  );
  expect(here).not.toHaveBeenCalled();
});

it("says so when only this device failed", async () => {
  await expect(signOutEverywhere(auth(null), async () => false)).resolves.toBe(
    "this_device_failed",
  );
});

it.each([
  new AuthApiError("Session not found", 403, "session_not_found"),
  new AuthSessionMissingError(),
])(
  "sends a session another device ended to sign in again (%p)",
  async (userError) => {
    const client = auth(null, userError);
    const here = jest.fn(async () => true);
    await expect(signOutEverywhere(client, here)).resolves.toBe(
      "session_ended",
    );
    expect(client.signOut).not.toHaveBeenCalled();
    expect(here).toHaveBeenCalledWith(client);
  },
);

it("keeps this session when Auth cannot check it", async () => {
  const client = auth(
    null,
    new AuthApiError("Service unavailable", 503, "unexpected_failure"),
  );
  const here = jest.fn();
  await expect(signOutEverywhere(client, here)).resolves.toBe("others_failed");
  expect(client.signOut).not.toHaveBeenCalled();
  expect(here).not.toHaveBeenCalled();
});
