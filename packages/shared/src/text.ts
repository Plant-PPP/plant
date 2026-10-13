// Text with its accents taken off, case kept: "Dólar" → "Dolar".
export const withoutAccents = (text: string): string =>
  text.normalize("NFD").replace(/\p{Diacritic}/gu, "");
