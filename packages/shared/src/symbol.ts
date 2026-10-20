const LOCAL = "[A-Z0-9]{1,15}";
const US = "[A-Z0-9]{1,10}(-[A-Z0-9]{1,2})?\\.US";

// A BYMA or crypto ticker, as the catalog keeps it.
export const LOCAL_SYMBOL_PATTERN = new RegExp(`^${LOCAL}$`);

// An instrument's catalog symbol: a BYMA or crypto ticker, or a US listing's
// ticker with .US, a class share's letter after a dash (BRK-B.US), so the
// same ticker can be a CEDEAR and a US share. The three symbol CHECKs in the
// migrations repeat it.
export const INSTRUMENT_SYMBOL_PATTERN = new RegExp(`^(${LOCAL}|${US})$`);

export const US_LISTING_SUFFIX = ".US";

// A US ticker as the catalog's symbol for its listing, or null when it does
// not fit: "brk b", "BRK.B" and "BRK/B" are BRK-B.US.
export function usListingSymbol(ticker: string): string | null {
  const symbol = `${ticker
    .trim()
    .toUpperCase()
    .replace(/[. /]/g, "-")}${US_LISTING_SUFFIX}`;
  return INSTRUMENT_SYMBOL_PATTERN.test(symbol) ? symbol : null;
}

// The ticker of a US listing's symbol (any case), else null.
export function usTicker(symbol: string): string | null {
  const text = symbol.trim().toUpperCase();
  if (!text.endsWith(US_LISTING_SUFFIX)) return null;
  return INSTRUMENT_SYMBOL_PATTERN.test(text)
    ? text.slice(0, -US_LISTING_SUFFIX.length)
    : null;
}

// A symbol as the user reads it: a US listing by its bare ticker (VOO.US is
// VOO), since its type and market say where it trades; any other as it is.
export const shownTicker = (symbol: string): string =>
  usTicker(symbol) ?? symbol;
