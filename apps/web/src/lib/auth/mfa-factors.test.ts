import { listVerifiedFactors, type AuthClient } from "./mfa-factors";

const factor = (id: string, status: string, factor_type = "totp") => ({
  id,
  status,
  factor_type,
  created_at: "",
  updated_at: "",
});

function client(result: { data: unknown; error: unknown }): AuthClient {
  return {
    auth: { mfa: { listFactors: async () => result } },
  } as unknown as AuthClient;
}

it("returns only verified factors", async () => {
  const verified = factor("a", "verified");
  const listed = await listVerifiedFactors(
    client({
      data: { all: [verified, factor("b", "unverified")], totp: [verified] },
      error: null,
    }),
  );
  expect(listed.verified.map((f) => f.id)).toEqual(["a"]);
  expect(listed.totp.map((f) => f.id)).toEqual(["a"]);
});

it("throws on an error instead of reading it as no factor", async () => {
  const error = new Error("down");
  await expect(listVerifiedFactors(client({ data: null, error }))).rejects.toBe(
    error,
  );
});
