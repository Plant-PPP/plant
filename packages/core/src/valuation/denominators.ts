import type { FxRateKind } from "../quotes/contract/quote";

// The units a value can be expressed in, on either side of a rate. Adding one
// is a member here and an entry in DENOMINATORS; a unit held as money (EUR)
// also needs its currency and rate kind.
export type Denominator =
  "ars" | "usd_mep" | "usd_ccl" | "usd_official" | "btc";

// How many pesos one unit is: pesos themselves; a dollar at its rate's
// selling price; or a unit priced in another (BTC is USD MEP times the BTC
// price). heldUsd is which dollar a held USD amount becomes when a view is in
// this unit: the view's own dollar, the user's reference dollar, or the one
// named. scale is the digits a value in this unit is shown to.
export type DenominatorSpec =
  | { scale: number; heldUsd: "reference" }
  | { fx: Exclude<FxRateKind, "uva">; scale: number; heldUsd: "self" }
  | { via: DollarUnit; priced: string; scale: number; heldUsd: DollarUnit };

type DollarUnit = Extract<Denominator, `usd_${string}`>;

export const DENOMINATORS = {
  ars: { scale: 2, heldUsd: "reference" },
  usd_mep: { fx: "mep", scale: 2, heldUsd: "self" },
  usd_ccl: { fx: "ccl", scale: 2, heldUsd: "self" },
  usd_official: { fx: "official", scale: 2, heldUsd: "self" },
  btc: { via: "usd_mep", priced: "BTC", scale: 8, heldUsd: "usd_mep" },
} as const satisfies Record<Denominator, DenominatorSpec>;
