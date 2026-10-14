import type { InstrumentType } from "@plant/core";

import type { AssetClass } from "./messages";

// What a holding is on the page: its instrument's type, or its class.
export type HoldingClass = InstrumentType | Exclude<AssetClass, "instrument">;

export const HOLDING_CLASS_LABELS: Record<HoldingClass, string> = {
  crypto: "Cripto",
  cedear: "CEDEAR",
  stock: "Acción",
  bond: "Bono",
  fci: "FCI",
  cash: "Efectivo",
  fixed_term: "Plazo fijo",
  real_estate: "Inmueble",
  other: "Otro",
};

// A class as a share of the whole names its holdings together.
export const HOLDING_CLASS_GROUP_LABELS: Record<HoldingClass, string> = {
  ...HOLDING_CLASS_LABELS,
  cedear: "CEDEARs",
  stock: "Acciones",
  bond: "Bonos",
  fci: "FCIs",
  real_estate: "Inmuebles",
  other: "Otros",
};

// Every class, in the order the labels list them.
export const HOLDING_CLASSES = Object.keys(
  HOLDING_CLASS_LABELS,
) as HoldingClass[];

export const isHoldingClass = (value: unknown): value is HoldingClass =>
  typeof value === "string" && Object.hasOwn(HOLDING_CLASS_LABELS, value);

export function classOf(row: {
  holding: { asset_class: AssetClass };
  instrumentType: InstrumentType | null;
}): HoldingClass {
  if (row.holding.asset_class !== "instrument") return row.holding.asset_class;
  if (row.instrumentType === null) {
    throw new RangeError("An instrument holding carries its type");
  }
  return row.instrumentType;
}
