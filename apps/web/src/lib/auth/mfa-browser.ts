import "client-only";
import type { AuthClient } from "./mfa-factors";
import { isInlineQrSvg } from "./qr-svg";

// Enroll, challenge and verify run in the browser: Auth rate-limits them per
// caller IP, and from the server every user would share one.

export type TotpEnrollment = {
  factorId: string;
  // SVG markup.
  qrCode: string;
  // The setup key for typing into the app.
  secret: string;
};

// Thrown here, not by Auth, when a verified TOTP factor exists.
export const TOTP_ALREADY_ON = "totp_already_on";

// enroll() leaves a factor unverified until a code is verified, and a second
// enroll cannot recover an abandoned factor's secret, so abandoned attempts are
// removed first. A verified one means another tab already turned it on, and
// Auth lets an aal2 session add a second one beside it.
export async function cleanupUnverifiedTotp(client: AuthClient): Promise<void> {
  const { data, error } = await client.auth.mfa.listFactors();
  if (error) throw error;
  if (
    data.all.some(
      (factor) => factor.factor_type === "totp" && factor.status === "verified",
    )
  ) {
    throw Object.assign(new Error("TOTP is already on"), {
      code: TOTP_ALREADY_ON,
    });
  }
  const stale = data.all.filter(
    (factor) => factor.factor_type === "totp" && factor.status === "unverified",
  );
  // unenroll() resolves with { error } instead of rejecting.
  const results = await Promise.all(
    stale.map((factor) => client.auth.mfa.unenroll({ factorId: factor.id })),
  );
  const failed = results.find((result) => result.error);
  if (failed?.error) throw failed.error;
}

const SVG_DATA_PREFIX = /^data:image\/svg\+xml;utf-8,/;

// No friendly name: Auth rejects one equal to an existing factor's, and the
// cleanup above already removes abandoned attempts.
export async function enrollTotp(client: AuthClient): Promise<TotpEnrollment> {
  const { data, error } = await client.auth.mfa.enroll({
    factorType: "totp",
    issuer: "Plant",
  });
  if (error) throw error;
  // auth-js wraps Auth's SVG in a data: URL; qr-svg.ts fixes the markup.
  const qrCode = data.totp.qr_code.replace(SVG_DATA_PREFIX, "");
  if (!isInlineQrSvg(qrCode)) throw new Error("Unexpected QR code format");
  return { factorId: data.id, qrCode, secret: data.totp.secret };
}

// What the switch in Ajustes runs: a failed cleanup does not enroll, so an
// abandoned factor never stacks up beside a new one.
export async function startEnrollment(
  client: AuthClient,
): Promise<TotpEnrollment> {
  await cleanupUnverifiedTotp(client);
  return enrollTotp(client);
}

// On success the session is aal2.
export async function verifyTotp(
  client: AuthClient,
  factorId: string,
  code: string,
): Promise<void> {
  const { error } = await client.auth.mfa.challengeAndVerify({
    factorId,
    code,
  });
  if (error) throw error;
}
