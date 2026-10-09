import { type AuthClient, listVerifiedFactors } from "@/lib/auth/mfa-factors";

export type TwoFactorStatus = "loading" | "failed" | "on" | "off";

// totpId is the factor the off switch asks a code for.
export type TwoFactorState = { status: TwoFactorStatus; totpId?: string };

// A failed load never reads as "off": an enrolled user would enroll again.
export async function fetchTwoFactorState(
  client: AuthClient,
): Promise<TwoFactorState> {
  try {
    const { verified, totp } = await listVerifiedFactors(client);
    return verified.length > 0
      ? { status: "on", totpId: totp[0]?.id }
      : { status: "off" };
  } catch {
    return { status: "failed" };
  }
}

export type TwoFactorPanel = "none" | "enroll" | "disable";

// The switch turns on from a loaded "off" and off from an "on" with a TOTP
// factor to ask a code for; it waits while either panel is open.
export function twoFactorSwitch(state: TwoFactorState, panel: TwoFactorPanel) {
  const ready =
    state.status === "off" ||
    (state.status === "on" && state.totpId !== undefined);
  return {
    checked: state.status === "on" || panel === "enroll",
    disabled: panel !== "none" || !ready,
  };
}
