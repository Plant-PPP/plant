import { OTP_LENGTH } from "./otp-config";

// Pasted codes arrive with spaces or dashes.
const codeDigits = (raw: string) => raw.replace(/\D/g, "");

export function sanitizeAuthCode(raw: string): string {
  return codeDigits(raw).slice(0, OTP_LENGTH);
}

// A whole code pasted or autofilled after the digits already there replaces
// them, so a wrong code can be overwritten without clearing it first.
export function nextAuthCode(previous: string, raw: string): string {
  const digits = codeDigits(raw);
  const added = digits.startsWith(previous)
    ? digits.slice(previous.length)
    : "";
  return (added.length >= OTP_LENGTH ? added : digits).slice(0, OTP_LENGTH);
}
