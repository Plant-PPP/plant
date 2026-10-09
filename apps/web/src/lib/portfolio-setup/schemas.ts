import { z } from "zod";

// Controls (NUL included); lone surrogates, which Postgres refuses in the
// request's JSON; invisible spaces; and the bidi overrides and isolates that
// can make one name read as another.
const UNSAFE = /[\p{Cc}\p{Cs}\u200b\u2060\ufeff\u202a-\u202e\u2066-\u2069]/u;

// NFC and single spaces, so two names that look the same are the same for the
// unique index. trim() strips every Unicode space, more than the CHECK's btrim,
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
    .refine((name) => !UNSAFE.test(name));
}

export function nameInputSchema(max: number) {
  return z.object({ name: trimmedName(max) });
}

export const idSchema = z.uuid();
