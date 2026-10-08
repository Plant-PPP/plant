import { OTP_LENGTH } from "./otp-config";

// Pasted codes arrive with spaces or dashes.
export function sanitizeAuthCode(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, OTP_LENGTH);
}
