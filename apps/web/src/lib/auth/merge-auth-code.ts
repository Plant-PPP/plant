import { OTP_LENGTH } from "./otp-config";

const n = OTP_LENGTH - 1;
const WHOLE_CODE = new RegExp(`(?:^|\\D)(\\d{${OTP_LENGTH}})(?!\\d)`);
const SPACED_CODE = new RegExp(`(?:^|\\D)(\\d(?:[ -]?\\d){${n}})(?![ -]?\\d)`);
const DIGIT_RUN = /\d(?:[ -]?\d)*/;

// Pasted text can carry the mail's other numbers (a date, "10 minutos"), so a
// whole code in it wins, written plainly or as "123 456" / "123-456";
// otherwise its first run of digits counts.
function codeIn(text: string): string {
  const run =
    WHOLE_CODE.exec(text)?.[1] ??
    SPACED_CODE.exec(text)?.[1] ??
    DIGIT_RUN.exec(text)?.[0] ??
    "";
  return run.replace(/\D/g, "");
}

// The field's new text after an edit at the end, where its caret always is.
// A whole code added there replaces the digits already in the field, and a
// browser autofill (replaceAll) replaces them outright; anything else is
// appended. An autofill whose text starts with the old digits keeps them:
// it can't be told apart from one that sends the code twice.
export function mergeAuthCode(
  previous: string,
  raw: string,
  replaceAll = false,
): string {
  const replaced = replaceAll || !raw.startsWith(previous);
  const added = codeIn(replaced ? raw : raw.slice(previous.length));
  const merged =
    replaced || added.length >= OTP_LENGTH ? added : previous + added;
  return merged.slice(0, OTP_LENGTH);
}
