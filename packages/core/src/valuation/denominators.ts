import type { FxRateKind } from "../quotes/contract/quote";

// The units a value can be expressed in, on either side of a rate. Adding one
// is a member here and an entry in DENOMINATORS; a unit held as money (EUR)
// also needs its currency and rate kind.
export type Denominator =
  "ars" | "usd_mep" | "usd_ccl" | "usd_official" | "btc" | "eur";

// How many pesos one unit is: pesos themselves; a dollar at its rate's
// selling price; or a unit priced in another (BTC is USD MEP times the BTC
// price). heldUsd is which dollar a held USD amount becomes when a view is in
// this unit: the view's own dollar, the user's reference dollar, or the one
// named. scale is the digits a value in this unit is shown to.
export type DenominatorSpec =
  | { scale: number; heldUsd: "reference" }
  | {
      fx: Exclude<FxRateKind, "uva">;
      scale: number;
      heldUsd: "self" | "reference";
    }
  | { via: DollarUnit; priced: string; scale: number; heldUsd: DollarUnit };

type DollarUnit = Extract<Denominator, `usd_${string}`>;

export const DENOMINATORS = {
  ars: { scale: 2, heldUsd: "reference" },
  usd_mep: { fx: "mep", scale: 2, heldUsd: "self" },
  usd_ccl: { fx: "ccl", scale: 2, heldUsd: "self" },
  usd_official: { fx: "official", scale: 2, heldUsd: "self" },
  btc: { via: "usd_mep", priced: "BTC", scale: 8, heldUsd: "usd_mep" },
  eur: { fx: "eur", scale: 2, heldUsd: "reference" },
} as const satisfies Record<Denominator, DenominatorSpec>;

export const isDenominator = (value: unknown): value is Denominator =>
  typeof value === "string" && Object.hasOwn(DENOMINATORS, value);

// The units a user can view their money in. EUR is a unit held money is
// valued from, not one the app shows totals in.
export const VIEW_UNITS = [
  "ars",
  "usd_mep",
  "usd_ccl",
  "usd_official",
  "btc",
] as const satisfies readonly Denominator[];
export type ViewUnit = (typeof VIEW_UNITS)[number];

export const isViewUnit = (value: unknown): value is ViewUnit =>
  typeof value === "string" &&
  (VIEW_UNITS as readonly string[]).includes(value);

type FxSpec = Extract<(typeof DENOMINATORS)[ViewUnit], { fx: string }>;
export type UnitFxKind = FxSpec["fx"];

// The rate kinds the view units are priced at: the rates every movement
// stores, and that a value in any view unit needs.
export const UNIT_FX_KINDS = VIEW_UNITS.flatMap((unit) => {
  const spec: DenominatorSpec = DENOMINATORS[unit];
  return "fx" in spec ? [spec.fx] : [];
}) as [UnitFxKind, ...UnitFxKind[]];

// The rate kinds a held amount can need: the view units' and the euro's.
export type ValuedFxKind = UnitFxKind | "eur";
export const VALUED_FX_KINDS: [ValuedFxKind, ...ValuedFxKind[]] = [
  ...UNIT_FX_KINDS,
  "eur",
];
