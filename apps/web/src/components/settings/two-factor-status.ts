import { type AuthClient, listVerifiedFactors } from "@/lib/auth/mfa-factors";

export type TwoFactorStatus = "loading" | "failed" | "on" | "off";

// A failed load never reads as "off": an enrolled user would enroll again.
export async function fetchTwoFactorStatus(
  client: AuthClient,
): Promise<TwoFactorStatus> {
  try {
    const { verified } = await listVerifiedFactors(client);
    return verified.length > 0 ? "on" : "off";
  } catch {
    return "failed";
  }
}

// The switch only turns on, and only from a loaded "off".
export function twoFactorSwitch(status: TwoFactorStatus, enrolling: boolean) {
  return {
    checked: status === "on" || enrolling,
    disabled: status !== "off" || enrolling,
  };
}
