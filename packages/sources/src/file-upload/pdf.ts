// The most pages of a PDF the readers take: a statement runs to a few; past
// this, a file costs every reading it gets without being one.
export const PDF_PAGE_LIMIT = 30;

// How many pages a PDF says it has, read in code before any model sees it:
// the largest /Count of a /Pages node, which the root's is, or else the
// /Page objects it lists. Null when neither is in plain sight, as in a PDF
// whose objects are compressed: the reading then goes on rather than refuse
// a file it cannot count.
export function pdfPageCount(bytes: Uint8Array): number | null {
  // Latin-1 keeps one character per byte, so the structure reads as text.
  const text = new TextDecoder("latin1").decode(bytes);
  let count = 0;
  for (const match of text.matchAll(
    /\/Type\s*\/Pages\b[^>]*?\/Count\s+(\d+)|\/Count\s+(\d+)[^>]*?\/Type\s*\/Pages\b/g,
  )) {
    count = Math.max(count, Number(match[1] ?? match[2]));
  }
  if (count > 0) return count;
  const pages = text.match(/\/Type\s*\/Page\b(?!s)/g)?.length ?? 0;
  return pages > 0 ? pages : null;
}
