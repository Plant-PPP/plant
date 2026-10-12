// Text as a search compares it: case and accents ignored, so "credito" finds
// "Crédito".
export const folded = (text: string): string =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
