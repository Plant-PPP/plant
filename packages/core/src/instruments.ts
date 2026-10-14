import {
  compareExact,
  Constants,
  type Currency,
  decimalStringSchema,
  exactOf,
  over,
  stored,
  times,
  withoutAccents,
} from "@plant/shared";

export const INSTRUMENT_TYPES = Constants.public.Enums.instrument_type;
export type InstrumentType = (typeof INSTRUMENT_TYPES)[number];

export type PricingBasis = 1 | 100;

// How a type's price is quoted: per unit, or per 100 nominal for a bond.
// Everything stored and computed is per unit.
export const INSTRUMENT_PRICING: Record<
  InstrumentType,
  { basis: PricingBasis }
> = {
  crypto: { basis: 1 },
  cedear: { basis: 1 },
  bond: { basis: 100 },
  fci: { basis: 1 },
};

const basisOf = (type: InstrumentType) => ({
  n: BigInt(INSTRUMENT_PRICING[type].basis),
  d: 1n,
});

// A quoted price as the price of one unit.
export const unitPrice = (type: InstrumentType, quoted: string): string =>
  stored(over(exactOf(quoted), basisOf(type)));

// A typed quote as the price of one unit, or null when the quote is not a
// decimal string numeric(20, 8) holds or 8 decimals cannot hold its unit price
// exactly: a price is never rounded on the way in.
export function exactUnitPrice(
  type: InstrumentType,
  quoted: string,
): string | null {
  if (!decimalStringSchema.safeParse(quoted).success) return null;
  const perUnit = over(exactOf(quoted), basisOf(type));
  const kept = unitPrice(type, quoted);
  return compareExact(exactOf(kept), perUnit) === 0 ? kept : null;
}

// A unit's price as the market quotes it.
export const quotedPrice = (type: InstrumentType, perUnit: string): string =>
  stored(times(exactOf(perUnit), basisOf(type)));

// A symbol or name as the catalog matches it: "Coca-Cola " and "COCA COLA"
// both read "COCACOLA".
export const normalizeSymbol = (text: string): string =>
  withoutAccents(text)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

export type CatalogInstrument = {
  symbol: string;
  type: InstrumentType;
  currency: Currency;
  aliases: readonly string[];
};

export type InstrumentIndex = {
  bySymbol: ReadonlyMap<string, CatalogInstrument>;
  byAlias: ReadonlyMap<string, CatalogInstrument>;
};

export function instrumentIndex(
  catalog: readonly CatalogInstrument[],
): InstrumentIndex {
  const bySymbol = new Map<string, CatalogInstrument>();
  const byAlias = new Map<string, CatalogInstrument>();
  for (const instrument of catalog) {
    const key = normalizeSymbol(instrument.symbol);
    if (!bySymbol.has(key)) bySymbol.set(key, instrument);
    for (const alias of instrument.aliases) {
      const aliasKey = normalizeSymbol(alias);
      if (!byAlias.has(aliasKey)) byAlias.set(aliasKey, instrument);
    }
  }
  return { bySymbol, byAlias };
}

// `currency` is what the document's line is in, `instrumentCurrency` what the
// instrument is quoted in: they differ on a D (MEP) or C (cable) line.
export type ResolvedSymbol = {
  symbol: string;
  type: InstrumentType;
  instrumentCurrency: Currency;
  currency: Currency;
};

const resolved = (
  instrument: CatalogInstrument,
  currency: Currency = instrument.currency,
): ResolvedSymbol => ({
  symbol: instrument.symbol,
  type: instrument.type,
  instrumentCurrency: instrument.currency,
  currency,
});

const DOLLAR_LINE_TYPES: readonly InstrumentType[] = ["bond", "cedear"];

// The catalog instrument a document's text names, or null. An exact symbol
// wins, so a catalog symbol ending in D or C is never read as a dollar line.
export function resolveSymbol(
  text: string,
  index: InstrumentIndex,
): ResolvedSymbol | null {
  const exact = index.bySymbol.get(normalizeSymbol(text));
  if (exact) return resolved(exact);
  const key = normalizeSymbol(text.trim().replace(/\.BA$/i, ""));
  if (key === "") return null;
  const local = index.bySymbol.get(key);
  if (local) return resolved(local);
  const base = /[DC]$/.test(key) ? index.bySymbol.get(key.slice(0, -1)) : null;
  if (base && DOLLAR_LINE_TYPES.includes(base.type)) {
    return resolved(base, "USD");
  }
  const alias = index.byAlias.get(key);
  return alias ? resolved(alias) : null;
}
