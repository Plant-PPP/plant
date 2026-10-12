import type {
  Movement,
  ChargeKind,
  Denominator,
  Holding,
  MovementKind,
} from "@plant/core";
import type { Currency } from "@plant/shared";

import { FAILED, WRITE_MESSAGES } from "@/lib/portfolio-setup/messages";

import type { HoldingDeleteResult } from "./delete-result";
import type { MovementLine, MovementResult } from "./movements-input";
import type { PriceResult } from "./price-input";

export type AssetClass = Holding["asset_class"];

export const ASSET_CLASS_LABELS: Record<AssetClass, string> = {
  instrument: "Instrumento",
  cash: "Efectivo",
  fixed_term: "Plazo fijo",
  real_estate: "Inmueble",
  other: "Otro",
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
  transfer: "Traspaso",
  yield: "Rendimiento",
};

const movementLabel = (movement: Movement): string => {
  if (movement.kind === "yield") {
    return movement.direction === "in" ? "Rendimiento" : "Rendimiento negativo";
  }
  return "direction" in movement
    ? `${MOVEMENT_KIND_LABELS[movement.kind]} (${movement.direction === "in" ? "entran" : "salen"})`
    : MOVEMENT_KIND_LABELS[movement.kind];
};

// A movement as a list names it: a transfer by the portfolio on its other
// side.
export function lineLabel({
  movement,
  operation,
}: Pick<MovementLine, "movement" | "operation">): string {
  const other = operation.parts.find(
    (part) => part.movement.holding_id !== movement.holding_id,
  );
  if (movement.kind !== "transfer" || !other) return movementLabel(movement);
  return movement.direction === "out"
    ? `Traspaso a ${other.portfolioName}`
    : `Traspaso desde ${other.portfolioName}`;
}

export const CHARGE_KIND_LABELS: Record<ChargeKind, string> = {
  commission: "Comisión",
  market_fee: "Derechos de mercado",
  vat: "IVA",
  tax: "Impuesto",
  other: "Otro",
};

export const FUTURE_DATE_MESSAGE = "La fecha no puede ser posterior a hoy.";

export const SAME_DAY_ORDER =
  "Si son del mismo día, cuenta el orden en que cargaste los movimientos.";

export const MOVEMENT_MESSAGES: Record<
  Extract<MovementResult, { ok: false }>["code"],
  string
> = {
  invalid: "Revisá los datos del movimiento.",
  not_found: "Esa tenencia ya no está.",
  failed: FAILED,
  oversold: `Saldrían más unidades de las que tenías en ese momento. ${SAME_DAY_ORDER}`,
  opening_balance: `El saldo inicial va primero y una sola vez. Sin saldo inicial, la tenencia empieza con una compra, un ajuste de entrada o un traspaso desde otra cartera. ${SAME_DAY_ORDER}`,
  future_date: FUTURE_DATE_MESSAGE,
  no_rate: "No hay cotización del dólar para esa fecha.",
  same_balance:
    "Es el saldo que ya tenías ese día: no hay rendimiento para cargar.",
  portfolio_archived: WRITE_MESSAGES.holdings.portfolio_archived,
  source_connection_archived:
    WRITE_MESSAGES.holdings.source_connection_archived,
};

export const PRICE_MESSAGES: Record<
  Extract<PriceResult, { ok: false }>["code"],
  string
> = {
  invalid: "Ingresá un precio mayor a 0 y una fecha.",
  failed: FAILED,
  future_date: FUTURE_DATE_MESSAGE,
};

// A delete refused for what the holding would be left with.
export const MOVEMENT_DELETE_MESSAGES: typeof MOVEMENT_MESSAGES = {
  ...MOVEMENT_MESSAGES,
  oversold: `No podés borrarlo: un movimiento posterior sacaría más unidades de las que tenías. ${SAME_DAY_ORDER}`,
  opening_balance: `No podés borrarlo: la tenencia tiene que empezar con un saldo inicial, una compra, un ajuste de entrada o un traspaso desde otra cartera. ${SAME_DAY_ORDER}`,
};

export const HOLDING_DELETE_MESSAGES: Record<
  Extract<HoldingDeleteResult, { ok: false }>["code"],
  string
> = {
  ...WRITE_MESSAGES.holdings,
  holding_has_transfers:
    "Tiene traspasos con otra cartera. Borralos primero desde sus movimientos.",
};
