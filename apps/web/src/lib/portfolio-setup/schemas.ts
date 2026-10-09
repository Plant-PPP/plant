import { z } from "zod";

// At least one letter, digit, punctuation mark or symbol, so no name renders
// blank.
const VISIBLE = /[\p{L}\p{N}\p{P}\p{S}]/u;

// Emoji, including the variation selector, zero-width joiners and tag
// characters that only build an emoji inside one: a tag flag, a keycap, or
// pictographs joined by ZWJ.
const EMOJI =
  /\u{1F3F4}[\u{E0020}-\u{E007E}]+\u{E007F}|[0-9#*]️?⃣|\p{Extended_Pictographic}\p{Emoji_Modifier}?️?(?:‍\p{Extended_Pictographic}\p{Emoji_Modifier}?️?)*/gu;

// Outside emoji: controls, lone surrogates (Postgres refuses them in the
// request's JSON), format characters (bidi marks, the zero-width joiner and
// non-joiner too) and every default-ignorable code point (soft hyphen,
// variation selectors, Hangul fillers), plus the blank braille pattern. All of
// them render as nothing, so two names that look the same would not collide.
const UNSAFE = /[\p{Cc}\p{Cs}\p{Cf}\p{Default_Ignorable_Code_Point}⠀]/u;

// NFC and single spaces, so composed and decomposed forms of a name, or the
// same name with doubled spaces, collide in the unique index. trim() strips
// every Unicode space, more than the CHECK's btrim, and zod 4's max() counts
// code points, as char_length does, so a name that passes is never refused by
// the table's CHECK.
function trimmedName(max: number) {
  return z
    .string()
    .trim()
    .normalize("NFC")
    .overwrite((name) => name.replace(/\s+/gu, " "))
    .min(1)
    .max(max)
    .refine(
      (name) => VISIBLE.test(name) && !UNSAFE.test(name.replace(EMOJI, "")),
    );
}

export function nameInputSchema(max: number) {
  return z.object({ name: trimmedName(max) });
}

export const idSchema = z.uuid();
