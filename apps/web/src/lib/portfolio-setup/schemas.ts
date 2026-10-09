import { z } from "zod";

// At least one letter, digit, punctuation mark or symbol, so no name renders
// blank.
const VISIBLE = /[\p{L}\p{N}\p{P}\p{S}]/u;

// Emoji-shaped sequences, where a variation selector, zero-width joiner or tag
// character belongs: a tag sequence after a black flag, a keycap, or
// pictographs joined by ZWJ. The shape is checked, not whether the emoji
// exists, so two look-alike emoji sequences can stay distinct names.
const EMOJI =
  /\u{1F3F4}[\u{E0020}-\u{E007E}]+\u{E007F}|[0-9#*]\uFE0F?\u20E3|\p{Extended_Pictographic}\p{Emoji_Modifier}?\uFE0F?(?:\u200D\p{Extended_Pictographic}\p{Emoji_Modifier}?\uFE0F?)*/gu;

// Outside those sequences: controls, lone surrogates (Postgres refuses them in
// the request's JSON), format characters (bidi marks, the zero-width joiner and
// non-joiner too), every default-ignorable code point (soft hyphen, variation
// selectors, Hangul fillers) and the blank symbols (braille blank, null
// notehead, Khitan filler). They render as nothing, so a name with one would
// look like another without colliding with it.
const UNSAFE =
  /[\p{Cc}\p{Cs}\p{Cf}\p{Default_Ignorable_Code_Point}\u2800\u{1D159}\u{16FE4}]/u;

// NFC, single spaces and no variation selector after an emoji that already
// shows as one, so composed and decomposed forms of a name, the same name with
// doubled spaces, or a thumbs up with and without U+FE0F collide in the unique
// index. trim() strips every Unicode space, more than the CHECK's btrim, and
// zod 4's max() counts code points, as char_length does, so a name that passes
// is never refused by the table's CHECK.
function trimmedName(max: number) {
  return z
    .string()
    .trim()
    .normalize("NFC")
    .overwrite((name) =>
      name
        .replace(/\s+/gu, " ")
        .replace(/(\p{Emoji_Presentation})\uFE0F+/gu, "$1"),
    )
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
