import { type AuthClient, listVerifiedFactors } from "@/lib/auth/mfa-factors";
import { SETTINGS_ITEM } from "@/lib/navigation";

// Where the step-up's sign-in comes back to: Ajustes with the off dialog open.
// The parameter only opens the dialog.
export const CONFIRM_DISABLE_PATH = `${SETTINGS_ITEM.href}?confirm=disable`;

export function confirmsDisable(searchParams: URLSearchParams): boolean {
  return searchParams.get("confirm") === "disable";
}

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

// Off needs a TOTP factor to ask a code for.
export function canDisable(state: TwoFactorState): state is {
  status: "on";
  totpId: string;
} {
  return state.status === "on" && state.totpId !== undefined;
}

export function twoFactorSwitch(state: TwoFactorState, panel: TwoFactorPanel) {
  const ready = state.status === "off" || canDisable(state);
  return {
    checked: state.status === "on" || panel === "enroll",
    disabled: panel !== "none" || !ready,
  };
}
