// Text from documents and from the user is untrusted: once it is inside a
// prompt it must not start a new line that reads as an instruction, nor open or
// close a delimited block such as </document>.

// Unicode's line terminators (UAX #13) and the information separators
// U+001C-U+001E, which Python's splitlines also breaks on. Escapes only: a raw
// U+2028 or U+2029 inside a regex literal is a syntax error.
const LINE_BREAKS = /\r\n|[\n\r\u000B\u000C\u001C-\u001E\u0085\u2028\u2029]/g;
// The angle brackets, the small and fullwidth forms that NFKC folds into them,
// the not-less/not-greater signs that NFD splits into them, and the invisible
// tag characters, which spell ASCII (U+E003C is a hidden "<") that some models
// read. Lone surrogates go too: removing a bracket between two halves would
// join them into a tag character.
const ANGLE_BRACKETS =
  /[<>\uFE64\uFE65\uFF1C\uFF1E\u226E\u226F]|[\u{E0000}-\u{E007F}]|\p{Cs}/gu;

export function stripPromptLineBreaks(value: string): string {
  return value.replace(LINE_BREAKS, " ");
}

export function neutralizePromptText(value: string): string {
  return stripPromptLineBreaks(value).replace(ANGLE_BRACKETS, "").trim();
}
