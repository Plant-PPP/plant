import { OTP_LENGTH } from "./otp-config";

const codeDigits = (text: string) => text.replace(/\D/g, "");

// The field's new text after an edit at the end, where its caret always is.
// A whole code pasted there replaces the digits already in the field, and an
// autofill replaces them outright; anything else is appended. Pasted codes
// arrive with spaces, dashes or the mail's text around them.
export function mergeAuthCode(
  previous: string,
  raw: string,
  inputType?: string,
): string {
  const replaced =
    inputType === "insertReplacementText" || !raw.startsWith(previous);
  const added = codeDigits(replaced ? raw : raw.slice(previous.length));
  const merged =
    replaced || added.length >= OTP_LENGTH ? added : previous + added;
  return merged.slice(0, OTP_LENGTH);
}
