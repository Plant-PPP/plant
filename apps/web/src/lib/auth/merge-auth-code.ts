import { OTP_LENGTH } from "./otp-config";

// A number in pasted text: groups of digits joined by up to three characters
// that are not letters, digits, "@" or line breaks ("123 456", "12-34-56").
const NUMBER = /\d+(?:[^0-9A-Za-zÀ-ɏ@\r\n]{1,3}\d+)*/g;
const WORD = /[0-9A-Za-zÀ-ɏ@_]/;
const HALVES = [Math.floor(OTP_LENGTH / 2), Math.ceil(OTP_LENGTH / 2)];

// Pasted text can carry the mail's other numbers (a date, "10 minutos", an
// address), so a whole code in it wins: written plainly or split in halves,
// then a code-length group inside a longer number ("10/10/2026 654321");
// otherwise its first number counts.
function codeIn(text: string): string {
  const numbers = [...text.matchAll(NUMBER)].map((match) => {
    const before = text[match.index - 1] ?? "";
    const after = text[match.index + match[0].length] ?? "";
    return {
      groups: match[0].match(/\d+/g) ?? [],
      alone: !WORD.test(before) && !WORD.test(after),
    };
  });
  const sizes = (n: (typeof numbers)[number]) =>
    n.groups.map((g) => g.length).join();
  const code =
    numbers.find((n) => n.alone && sizes(n) === `${OTP_LENGTH}`) ??
    numbers.find((n) => n.alone && sizes(n) === HALVES.join());
  if (code) return code.groups.join("");
  const group = numbers
    .flatMap((n) => n.groups)
    .find((g) => g.length === OTP_LENGTH);
  return group ?? numbers[0]?.groups.join("") ?? "";
}

// The field's new text after an edit at the end, where its caret always is.
// Six or more digits added there replace the digits already in the field, and
// a browser autofill (replaceAll) replaces them outright; fewer are appended. An autofill whose text starts with the old digits keeps them:
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
