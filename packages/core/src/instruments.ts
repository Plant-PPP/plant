import {
  compareExact,
  Constants,
  exactOf,
  over,
  times,
  toDecimal,
} from "@plant/shared";

// The instrument types the instrument_type enum does not hold yet. The test
// that keeps both lists apart fails the day a migration adds them, which is
// when they leave this list.
export const PENDING_INSTRUMENT_TYPES = ["cedear", "bond", "fci"] as const;

export const INSTRUMENT_TYPES = [
  ...Constants.public.Enums.instrument_type,
  ...PENDING_INSTRUMENT_TYPES,
] as const;
export type InstrumentType = (typeof INSTRUMENT_TYPES)[number];

// How a type's price is quoted: per unit, or per 100 nominal for a bond.
// Everything stored and computed is per unit.
export const INSTRUMENT_PRICING: Record<InstrumentType, { basis: 1 | 100 }> = {
  crypto: { basis: 1 },
  cedear: { basis: 1 },
  bond: { basis: 100 },
  fci: { basis: 1 },
};

const PRICE_DIGITS = 8;
const basisOf = (type: InstrumentType) => ({
  n: BigInt(INSTRUMENT_PRICING[type].basis),
  d: 1n,
});

// A quoted price as the price of one unit.
export const unitPrice = (type: InstrumentType, quoted: string): string =>
  toDecimal(over(exactOf(quoted), basisOf(type)), PRICE_DIGITS);

// A typed quote as the price of one unit, or null when 8 decimals cannot hold
// it exactly: a price is never rounded on the way in.
export function exactUnitPrice(
  type: InstrumentType,
  quoted: string,
): string | null {
  const perUnit = over(exactOf(quoted), basisOf(type));
  const kept = unitPrice(type, quoted);
  return compareExact(exactOf(kept), perUnit) === 0 ? kept : null;
}

// A unit's price as the market quotes it.
export const quotedPrice = (type: InstrumentType, perUnit: string): string =>
  toDecimal(times(exactOf(perUnit), basisOf(type)), PRICE_DIGITS);
