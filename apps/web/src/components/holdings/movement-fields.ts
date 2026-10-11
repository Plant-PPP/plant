import {
  isIncome,
  isTrade,
  type Movement,
  type MovementKind,
} from "@plant/core";
import type { Currency } from "@plant/shared";
import type { z } from "zod";

import type { FieldAlert } from "@/components/portfolio-setup/field-alert";
import { firstRefused } from "@/components/portfolio-setup/refusal";
import { amountInput, parseAmountInput } from "@/lib/format/amount";
import { MOVEMENT_MESSAGES } from "@/lib/holdings/messages";

// What the movement dialog holds, as typed.
export type MovementFields = {
  kind: MovementKind;
  holdingId: string;
  date: string;
  quantity: string;
  price: string;
  amount: string;
  currency: Currency;
  fees: string;
  taxes: string;
};

export type MovementField =
  | "kind"
  | "holding"
  | "date"
  | "quantity"
  | "price"
  | "amount"
  | "currency"
  | "fees"
  | "taxes";

export function initialMovementFields(
  movement: Movement | null,
  defaults: Pick<MovementFields, "kind" | "holdingId" | "currency" | "date"> & {
    quantity?: string;
  },
): MovementFields {
  if (!movement) {
    return {
      ...defaults,
      quantity: defaults.quantity ? amountInput(defaults.quantity) : "",
      price: "",
      amount: "",
      fees: "",
      taxes: "",
    };
  }
  return {
    kind: movement.kind,
    holdingId: movement.holding_id,
    date: movement.date,
    currency: movement.currency,
    quantity: isTrade(movement) ? amountInput(movement.quantity) : "",
    price: isTrade(movement) ? amountInput(movement.price) : "",
    amount: isTrade(movement) ? "" : amountInput(movement.amount),
    fees: amountInput(movement.fees),
    taxes: amountInput(movement.taxes),
  };
}

// An empty charge is none; a value the parser refuses goes as null, for the
// schema to name its field.
const charge = (text: string) =>
  text.trim() === "" ? "0" : parseAmountInput(text);

// What the dialog sends: the kind's fields only.
export function toMovementInput(fields: MovementFields) {
  const common = {
    holding_id: fields.holdingId,
    kind: fields.kind,
    date: fields.date,
    currency: fields.currency,
    fees: charge(fields.fees),
    taxes: charge(fields.taxes),
  };
  return isIncome(fields.kind)
    ? { ...common, amount: parseAmountInput(fields.amount) }
    : {
        ...common,
        quantity: parseAmountInput(fields.quantity),
        price: parseAmountInput(fields.price),
      };
}

export const MOVEMENT_FIELD_MESSAGES: Record<MovementField, string> = {
  kind: "Elegí qué pasó.",
  holding: "Elegí una tenencia.",
  date: "Elegí una fecha.",
  quantity: "Ingresá una cantidad mayor a 0.",
  price: "Ingresá un precio de 0 o más.",
  amount: "Ingresá un monto mayor a 0.",
  currency: "Elegí una moneda.",
  fees: "Ingresá las comisiones como un número, o dejalas vacías.",
  taxes: "Ingresá los impuestos como un número, o dejalos vacíos.",
};

const FIELD_BY_COLUMN: Record<string, MovementField> = {
  kind: "kind",
  holding_id: "holding",
  date: "date",
  quantity: "quantity",
  price: "price",
  amount: "amount",
  currency: "currency",
  fees: "fees",
  taxes: "taxes",
};
const FORM_ORDER: readonly MovementField[] = [
  "kind",
  "holding",
  "date",
  "quantity",
  "price",
  "amount",
  "currency",
  "fees",
  "taxes",
];

export function movementRefusal(error: z.ZodError): FieldAlert<MovementField> {
  const first = firstRefused(error, FIELD_BY_COLUMN, FORM_ORDER);
  return first
    ? { field: first.field, text: MOVEMENT_FIELD_MESSAGES[first.field] }
    : { field: null, text: MOVEMENT_MESSAGES.invalid };
}

// The field a refused write's alert is about, when it is about one.
export function refusedMovementField(text: string): MovementField | null {
  if (text === MOVEMENT_MESSAGES.oversold) return "quantity";
  if (text === MOVEMENT_MESSAGES.future_date) return "date";
  if (text === MOVEMENT_MESSAGES.no_rate) return "date";
  if (text === MOVEMENT_MESSAGES.opening_balance) return "kind";
  return null;
}
