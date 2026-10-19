import type { CashMovementKind } from "@plant/core";

import { FAILED } from "@/lib/portfolio-setup/messages";

import type { CashEntryKind, CashRefusalCode } from "./input";

export const CASH_KIND_LABELS: Record<CashMovementKind, string> = {
  opening_balance: "Saldo inicial",
  deposit: "Depósito",
  withdrawal: "Extracción",
  settlement: "Operación",
  income: "Crédito",
  charge: "Gasto",
};

export const CASH_ENTRY_LABELS: Record<CashEntryKind, string> = {
  opening_balance: CASH_KIND_LABELS.opening_balance,
  deposit: CASH_KIND_LABELS.deposit,
  withdrawal: CASH_KIND_LABELS.withdrawal,
};

export const CASH_MESSAGES: Record<CashRefusalCode, string> = {
  invalid: "Revisá el monto y la fecha.",
  not_found: "La cuenta cambió hace un momento. Recargá la página.",
  failed: FAILED,
  no_rate: "No hay cotización del dólar para esa fecha.",
  needs_opening:
    "Primero cargá el saldo inicial: el historial del efectivo empieza con él.",
  before_opening:
    "Esa fecha es anterior al saldo inicial: elegí una igual o posterior, o cambiá el saldo inicial.",
  future: "La fecha no puede ser posterior a hoy.",
  negative_cash: "Con eso el efectivo de la cuenta quedaría por debajo de 0.",
  other_account: "Esa operación es de otra cuenta.",
  stale: "El efectivo cambió hace un momento. Probá de nuevo.",
};

export const STATEMENT_MESSAGES: Record<
  CashRefusalCode | "unsupported" | "too_large",
  string
> = {
  ...CASH_MESSAGES,
  unsupported:
    "No reconocemos este archivo. Subí los Movimientos históricos que exporta IOL (.xls).",
  too_large: "El archivo es demasiado grande.",
  negative_cash:
    "El archivo saca más efectivo del que la cuenta tiene hoy: revisá que cubra todo el período o cargá el saldo inicial a mano.",
};
