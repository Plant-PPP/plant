import {
  type LiabilityEvent,
  type LiabilityEventKind,
  liabilityEventInputSchema,
} from "@plant/core";
import type { Currency } from "@plant/shared";

import {
  amountInput,
  parseAmountInput,
  percentInput,
  percentToFraction,
} from "@/lib/format/amount";
import { FAILED } from "@/lib/portfolio-setup/messages";
import type { DebtEventCode } from "@/lib/debts/events-write";

// A cash holding a payment can come from, with its amount as the page read it.
export type CashOption = {
  id: string;
  label: string;
  currency: Currency;
  amount: string;
};

// What the event dialog holds, as typed.
export type DebtEventFields = {
  kind: LiabilityEventKind;
  date: string;
  amount: string;
  rate: string;
  settles: boolean;
  // "" when the payment names no cash holding.
  cashHoldingId: string;
  take: boolean;
};

export function eventFields(
  kind: LiabilityEventKind,
  event: LiabilityEvent | null,
  today: string,
  prefill: Partial<DebtEventFields> = {},
): DebtEventFields {
  if (!event) {
    return {
      kind,
      date: today,
      amount: "",
      rate: "",
      settles: false,
      cashHoldingId: "",
      take: false,
      ...prefill,
    };
  }
  return {
    kind: event.kind,
    date: event.date,
    amount: event.amount === null ? "" : amountInput(event.amount),
    rate: event.annual_rate === null ? "" : percentInput(event.annual_rate),
    settles: event.settles,
    cashHoldingId: event.cash_holding_id ?? "",
    take: event.takes_cash,
  };
}

// What the dialog sends for the event. A value the parsers refuse goes as the
// text, for the schema to refuse.
export function toEventInput(fields: DebtEventFields) {
  const amount = parseAmountInput(fields.amount) ?? fields.amount;
  switch (fields.kind) {
    case "rate_change":
      return {
        kind: fields.kind,
        date: fields.date,
        annual_rate: percentToFraction(fields.rate) ?? fields.rate,
      };
    case "payment":
      return {
        kind: fields.kind,
        date: fields.date,
        amount,
        settles: fields.settles,
      };
    case "adjustment":
      return { kind: fields.kind, date: fields.date, amount };
  }
}

export const eventInputValid = (fields: DebtEventFields): boolean =>
  liabilityEventInputSchema.safeParse(toEventInput(fields)).success;

// The cash a payment came from, and whether to take it now, checked against
// the holding's amount as the page read it.
export function toCashInput(
  fields: DebtEventFields,
  cash: readonly CashOption[],
) {
  if (fields.kind !== "payment" || fields.cashHoldingId === "") return null;
  const holding = cash.find((each) => each.id === fields.cashHoldingId);
  return {
    holding_id: fields.cashHoldingId,
    take: fields.take,
    expected: holding?.amount ?? null,
  };
}

export const DEBT_EVENT_INVALID =
  "Revisá la fecha y el monto: un pago va mayor a 0 y una tasa hasta 1000 %.";

// The copy for each code an event write can be refused with.
export const DEBT_EVENT_MESSAGES: Record<DebtEventCode, string> = {
  future_date: "La fecha es posterior a hoy.",
  has_history: "Esta deuda ya tiene movimientos y no cambia de moneda.",
  before_opening: "La fecha es anterior al inicio de la deuda.",
  no_history: "Las tarjetas siguen su resumen y no llevan movimientos.",
  no_cash_link: "Esta deuda no se paga desde una cuenta.",
  settled:
    "La deuda ya estaba cancelada en esa fecha. Si volvió a tener saldo, ajustá el saldo antes.",
  currency: "Esa cuenta está en otra moneda.",
  stale: "El efectivo de esa cuenta cambió hace un momento. Probá de nuevo.",
  insufficient_cash: "Esa cuenta no tiene tanto efectivo.",
  last_active_portfolio: FAILED,
  portfolio_in_use: FAILED,
  portfolio_archived: "La cartera de esa cuenta está archivada.",
  portfolio_has_holdings: FAILED,
  source_connection_has_holdings: FAILED,
  source_connection_archived: "Esa cuenta está archivada.",
  not_found:
    "Ese movimiento cambió hace un momento. Ya actualizamos la página.",
  invalid: DEBT_EVENT_INVALID,
  retry: FAILED,
  failed: FAILED,
};

// Said after an edit or a delete whose cash could not go back to its account.
export const CASH_NOT_RESTORED =
  "El efectivo que había salido de la cuenta no se pudo devolver: revisalo en Activos.";
