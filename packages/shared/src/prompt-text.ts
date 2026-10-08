// Text from documents and from the user is untrusted: once it is inside a
// prompt it must not start a new line that reads as an instruction, nor open or
// close a delimited block such as </document>.

// Every line terminator a model or a JSON parser may honour. Escapes only: a
// raw U+2028 or U+2029 inside a regex literal is a syntax error.
const LINE_BREAKS = /\r\n|[\n\r\u000B\u000C\u0085\u2028\u2029]/g;
const ANGLE_BRACKETS = /[<>]/g;

export function stripPromptLineBreaks(value: string): string {
  return value.replace(LINE_BREAKS, " ");
}

export function neutralizePromptText(value: string): string {
  return stripPromptLineBreaks(value).replace(ANGLE_BRACKETS, "").trim();
}
