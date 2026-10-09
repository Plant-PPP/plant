import { z } from "zod";

// trim() strips every Unicode space, more than the CHECK's btrim, and max()
// counts code points, as char_length does, so a name that passes is never
// refused by the table's CHECK.
function trimmedName(max: number) {
  return z.string().trim().min(1).max(max);
}

export function nameInputSchema(max: number) {
  return z.object({ name: trimmedName(max) });
}

export const idSchema = z.uuid();
