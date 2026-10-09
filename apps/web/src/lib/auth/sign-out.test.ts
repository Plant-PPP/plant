import { signOutAndConfirm } from "./sign-out";

type Auth = Parameters<typeof signOutAndConfirm>[0];

function auth(
  signOutError: unknown,
  after: { session: unknown; error: unknown } = { session: null, error: null },
): Auth & { signOut: jest.Mock } {
  return {
    signOut: jest.fn(async () => ({ error: signOutError })),
    getSession: async () => ({
      data: { session: after.session },
      error: after.error,
    }),
  } as unknown as Auth & { signOut: jest.Mock };
}

it("signs out this device only", async () => {
  const client = auth(null);
  await expect(signOutAndConfirm(client)).resolves.toBe(true);
  expect(client.signOut).toHaveBeenCalledWith({ scope: "local" });
});

it("counts a failed revoke as signed out once the session is gone", async () => {
  await expect(signOutAndConfirm(auth(new Error("revoke")))).resolves.toBe(
    true,
  );
});

it.each([
  ["the session is still there", { session: {}, error: null }],
  ["it cannot load the session", { session: null, error: new Error("x") }],
])("reports a failure when %s", async (_, after) => {
  await expect(
    signOutAndConfirm(auth(new Error("revoke"), after)),
  ).resolves.toBe(false);
});
