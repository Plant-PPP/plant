import type {
  ChargeKind,
  Denominator,
  Holding,
  MovementKind,
} from "@plant/core";
import type { Currency } from "@plant/shared";

import { FAILED } from "@/lib/portfolio-setup/messages";

import type { MovementResult } from "./movements-input";

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

export const CURRENCY_LABELS: Record<Currency, string> = {
  ARS: "Pesos (ARS)",
  USD: "Dólares (USD)",
};

export const MOVEMENT_KIND_LABELS: Record<MovementKind, string> = {
  opening_balance: "Saldo inicial",
  purchase: "Compra",
  sale: "Venta",
  dividend: "Dividendo",
  coupon: "Cupón",
  adjustment: "Ajuste",
};

export const CHARGE_KIND_LABELS: Record<ChargeKind, string> = {
  commission: "Comisión",
  market_fee: "Derechos de mercado",
  vat: "IVA",
  tax: "Impuesto",
  other: "Otro",
};

export const FUTURE_DATE_MESSAGE = "La fecha no puede ser posterior a hoy.";

export const MOVEMENT_MESSAGES: Record<
  Extract<MovementResult, { ok: false }>["code"],
  string
> = {
  invalid: "Revisá los datos del movimiento.",
  not_found: "Esa tenencia ya no está.",
  failed: FAILED,
  oversold: "No podés vender más de lo que tenías en esa fecha.",
  opening_balance:
    "Una tenencia empieza con un saldo inicial o una compra, y el saldo inicial va una sola vez.",
  future_date: FUTURE_DATE_MESSAGE,
  no_rate: "No hay cotización del dólar para esa fecha.",
};
