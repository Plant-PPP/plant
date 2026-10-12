// Text as a search compares it: case and accents ignored, so "credito" finds
// "Crédito".
export const folded = (text: string): string =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

// How many of `days` fall in `today`'s month, what a monthly allowance has
// used.
export const usedThisMonth = (days: readonly string[], today: string) =>
  days.filter((day) => day.slice(0, 7) === today.slice(0, 7)).length;

// What is left of a monthly allowance: "Te queda 1 de 10 cargas este mes".
export const leftThisMonth = (left: number, total: number, noun: string) =>
  `${left === 1 ? "Te queda" : "Te quedan"} ${left} de ${total} ${noun} este mes`;
