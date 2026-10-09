// Trimmed, NFC, single spaces and no variation selector after an emoji that
// already shows as one, so composed and decomposed forms of a name, the same
// name with doubled spaces, or a thumbs up with and without U+FE0F collide in
// the unique index. The name dialog uses it to show the name as saved.
export function normalizeName(name: string): string {
  return name
    .trim()
    .normalize("NFC")
    .replace(/\s+/gu, " ")
    .replace(/(\p{Emoji_Presentation})\uFE0F+/gu, "$1");
}
