import { attempt } from "./use-auth-request";

it("keeps the code of a thrown Auth error", async () => {
  await expect(
    attempt(async () => {
      throw Object.assign(new Error("Invalid TOTP code entered"), {
        code: "mfa_verification_failed",
      });
    }),
  ).resolves.toEqual({ code: "mfa_verification_failed" });
});

it.each([new Error("network"), null, "text", { code: 42 }])(
  "reads %p thrown as a failure without a code",
  async (thrown) => {
    await expect(
      attempt(async () => {
        throw thrown;
      }),
    ).resolves.toEqual({ code: undefined });
  },
);

it("passes a returned failure or success through", async () => {
  await expect(attempt(async () => ({ code: "x" }))).resolves.toEqual({
    code: "x",
  });
  await expect(attempt(async () => null)).resolves.toBeNull();
});
