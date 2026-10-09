jest.mock("client-only", () => ({}), { virtual: true });

import { cleanupUnverifiedTotp, enrollTotp, verifyTotp } from "./mfa-browser";
import type { AuthClient } from "./mfa-factors";

const factor = (id: string, status: string, factor_type = "totp") => ({
  id,
  status,
  factor_type,
});

function fakeClient(mfa: Record<string, unknown>): AuthClient {
  return { auth: { mfa } } as unknown as AuthClient;
}

describe("cleanupUnverifiedTotp", () => {
  it("unenrolls only unverified TOTP factors", async () => {
    const unenroll = jest.fn(async () => ({ data: {}, error: null }));
    await cleanupUnverifiedTotp(
      fakeClient({
        listFactors: async () => ({
          data: {
            all: [
              factor("verified", "verified"),
              factor("stale", "unverified"),
              factor("phone", "unverified", "phone"),
            ],
          },
          error: null,
        }),
        unenroll,
      }),
    );
    expect(unenroll.mock.calls).toEqual([[{ factorId: "stale" }]]);
  });

  it("throws when an unenroll fails", async () => {
    const error = new Error("nope");
    await expect(
      cleanupUnverifiedTotp(
        fakeClient({
          listFactors: async () => ({
            data: { all: [factor("stale", "unverified")] },
            error: null,
          }),
          unenroll: async () => ({ data: null, error }),
        }),
      ),
    ).rejects.toBe(error);
  });

  it("throws when the list fails", async () => {
    const error = new Error("down");
    const unenroll = jest.fn();
    await expect(
      cleanupUnverifiedTotp(
        fakeClient({
          listFactors: async () => ({ data: null, error }),
          unenroll,
        }),
      ),
    ).rejects.toBe(error);
    expect(unenroll).not.toHaveBeenCalled();
  });
});

describe("enrollTotp", () => {
  const enrolled = (qr_code: string) =>
    fakeClient({
      enroll: async (params: unknown) => ({
        data: { id: "f", totp: { qr_code, secret: "S" }, params },
        error: null,
      }),
    });

  it("unwraps auth-js's data: URL into SVG markup", async () => {
    await expect(
      enrollTotp(enrolled('data:image/svg+xml;utf-8,<svg width="1"></svg>')),
    ).resolves.toEqual({
      factorId: "f",
      qrCode: '<svg width="1"></svg>',
      secret: "S",
    });
  });

  it("rejects a QR that is not SVG markup", async () => {
    await expect(
      enrollTotp(enrolled("data:image/png;base64,abc")),
    ).rejects.toThrow("Unexpected QR code format");
  });

  it("enrolls TOTP under Plant without a friendly name", async () => {
    const enroll = jest.fn(async () => ({
      data: { id: "f", totp: { qr_code: "<svg></svg>", secret: "S" } },
      error: null,
    }));
    await enrollTotp(fakeClient({ enroll }));
    expect(enroll).toHaveBeenCalledWith({
      factorType: "totp",
      issuer: "Plant",
    });
  });
});

it("verifyTotp throws Auth's error", async () => {
  const error = { code: "mfa_verification_failed" };
  await expect(
    verifyTotp(
      fakeClient({ challengeAndVerify: async () => ({ error }) }),
      "f",
      "123456",
    ),
  ).rejects.toBe(error);
});
