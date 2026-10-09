import { OTP_LENGTH } from "./otp-config";

// Spaces of any kind, dots and dashes (‐ to ―, and -).
const SEP = "[\\s.\\u2010-\\u2015-]";
// A code doesn't touch a letter, a digit or an "@", so numbers in an address
// or inside a longer number are skipped.
const START = "(?:^|[^A-Za-z0-9_@])";
const END = "(?![A-Za-z0-9_@])";
const half = OTP_LENGTH / 2;
const WHOLE_CODE = new RegExp(`${START}(\\d{${OTP_LENGTH}})${END}`);
const SPLIT_CODE = new RegExp(
  `${START}(\\d{${half}}${SEP}{1,3}\\d{${half}})(?!${SEP}*\\d)${END}`,
);
const DIGIT_RUN = new RegExp(`\\d(?:${SEP}{0,3}\\d)*`);

// Pasted text can carry the mail's other numbers (a date, "10 minutos"), so a
// whole code in it wins, written plainly or split in halves ("123 456");
// otherwise its first run of digits counts.
function codeIn(text: string): string {
  const run =
    WHOLE_CODE.exec(text)?.[1] ??
    SPLIT_CODE.exec(text)?.[1] ??
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
