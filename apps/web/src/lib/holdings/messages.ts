import type { Denominator, Holding } from "@plant/core";

export type AssetClass = Holding["asset_class"];

export const ASSET_CLASS_LABELS: Record<AssetClass, string> = {
  instrument: "Cripto",
  cash: "Efectivo",
  fixed_term: "Plazo fijo",
  real_estate: "Inmueble",
  other: "Otro",
};

// A class as a share of the whole names its holdings together.
export const ASSET_CLASS_GROUP_LABELS: Record<AssetClass, string> = {
  ...ASSET_CLASS_LABELS,
  real_estate: "Inmuebles",
  other: "Otros",
};

// Every class, in the order the labels list them.
export const ASSET_CLASSES = Object.keys(ASSET_CLASS_LABELS) as AssetClass[];

export const UNIT_LABELS: Record<Denominator, string> = {
  ars: "Pesos",
  usd_mep: "Dólar MEP",
  usd_ccl: "Dólar CCL",
  usd_official: "Dólar oficial",
  btc: "Bitcoin",
};
