import { z } from "zod";

// After whitespace (tabs, newlines included) becomes one space: other controls,
// lone surrogates (Postgres refuses them in the request's JSON), the Hangul
// fillers that render blank, and every invisible format character (soft
// hyphen, zero-width space, bidi marks and overrides) but the zero-width
// joiner and the tag characters that emoji are built from.
// At least one letter, digit, punctuation mark or symbol, so no name renders
// blank.
const VISIBLE = /[\p{L}\p{N}\p{P}\p{S}]/u;

const UNSAFE =
  /[\p{Cc}\p{Cs}\u115f\u1160\u2800\u3164\uffa0]|(?!\u200d)(?![\u{e0020}-\u{e007f}])\p{Cf}/u;

// NFC and single spaces, so composed and decomposed forms of a name, or the
// same name with doubled spaces, collide in the unique index. trim() strips every Unicode space, more than the CHECK's btrim,
// and zod 4's max() counts code points, as char_length does, so a name that
// passes is never refused by the table's CHECK.
function trimmedName(max: number) {
  return z
    .string()
    .trim()
    .normalize("NFC")
    .overwrite((name) => name.replace(/\s+/gu, " "))
    .min(1)
    .max(max)
    .refine((name) => VISIBLE.test(name) && !UNSAFE.test(name));
}

export function nameInputSchema(max: number) {
  return z.object({ name: trimmedName(max) });
}

export const idSchema = z.uuid();
