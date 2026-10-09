import { AuthApiError, AuthSessionMissingError } from "@supabase/supabase-js";
import { signOutEverywhere } from "./sign-out-everywhere-steps";

type Auth = Parameters<typeof signOutEverywhere>[0];

const auth = (othersError: unknown, userError: unknown = null) => {
  const calls: string[] = [];
  const client = {
    signOut: jest.fn(async () => {
      calls.push("others");
      return { error: othersError };
    }),
    getUser: jest.fn(async () => {
      calls.push("user");
      return { data: { user: null }, error: userError };
    }),
    getSession: jest.fn(),
  } as unknown as Auth & { signOut: jest.Mock; getUser: jest.Mock };
  return { client, calls };
};

it("signs out the other devices, checks this session, then signs out here", async () => {
  const { client, calls } = auth(null);
  const here = jest.fn(async () => {
    calls.push("here");
    return true;
  });
  await expect(signOutEverywhere(client, here)).resolves.toBe("done");
  expect(client.signOut).toHaveBeenCalledWith({ scope: "others" });
  expect(here).toHaveBeenCalledWith(client);
  expect(calls).toEqual(["others", "user", "here"]);
});

it("keeps this session when the other devices could not be signed out", async () => {
  const { client } = auth(new Error("x"));
  const here = jest.fn();
  await expect(signOutEverywhere(client, here)).resolves.toBe("others_failed");
  expect(client.getUser).not.toHaveBeenCalled();
  expect(here).not.toHaveBeenCalled();
});

it("says so when only this device failed", async () => {
  await expect(
    signOutEverywhere(auth(null).client, async () => false),
  ).resolves.toBe("this_device_failed");
});

it.each([
  new AuthApiError("Session not found", 403, "session_not_found"),
  new AuthSessionMissingError(),
])(
  "sends a session another device ended to sign in again (%p)",
  async (userError) => {
    const { client } = auth(null, userError);
    const here = jest.fn(async () => true);
    await expect(signOutEverywhere(client, here)).resolves.toBe(
      "session_ended",
    );
    expect(here).toHaveBeenCalledWith(client);
  },
);

it("asks for a retry when an ended session cannot be cleared here", async () => {
  await expect(
    signOutEverywhere(
      auth(null, new AuthSessionMissingError()).client,
      async () => false,
    ),
  ).resolves.toBe("others_failed");
});

it("trusts the revoke when Auth cannot check this session afterwards", async () => {
  const { client } = auth(
    null,
    new AuthApiError("Service unavailable", 503, "unexpected_failure"),
  );
  await expect(signOutEverywhere(client, async () => true)).resolves.toBe(
    "done",
  );
});
