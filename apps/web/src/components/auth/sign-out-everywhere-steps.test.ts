import { signOutEverywhere } from "./sign-out-everywhere-steps";

type Auth = Parameters<typeof signOutEverywhere>[0];

const auth = (othersError: unknown) =>
  ({
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
