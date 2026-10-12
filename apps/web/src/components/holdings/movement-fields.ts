import {
  type ChargeKind,
  type InstrumentType,
  isIncome,
  isTrade,
  type Movement,
  type MovementKind,
  exactUnitPrice,
  quotedPrice,
} from "@plant/core";
import { type Currency, exactOf, plus, stored } from "@plant/shared";
import type { z } from "zod";

import type { FieldAlert } from "@/components/portfolio-setup/field-alert";
import { firstRefused } from "@/components/portfolio-setup/refusal";
import { amountInput, parseAmountInput } from "@/lib/format/amount";
import { MOVEMENT_MESSAGES } from "@/lib/holdings/messages";

// One portfolio's part of an operation, as typed: its quantity, or an
// income's amount.
export type PartFields = { portfolioId: string; size: string };
export type ChargeFields = { kind: ChargeKind; label: string; amount: string };

// What the movement dialog holds, as typed.
export type MovementFields = {
  kind: MovementKind;
  direction: "in" | "out";
  accountId: string;
  instrument: string;
  date: string;
  price: string;
  currency: Currency;
  parts: PartFields[];
  charges: ChargeFields[];
  reference: string;
  note: string;
};

export type MovementField =
  | "kind"
  | "direction"
  | "account"
  | "instrument"
  | "date"
  | "price"
  | "currency"
  | "parts"
  | "charges"
  | "reference"
  | "note";

export function newMovementFields(
  defaults: Pick<
    MovementFields,
    "kind" | "accountId" | "instrument" | "currency" | "date"
  > & { portfolioId: string; size?: string },
): MovementFields {
  return {
    kind: defaults.kind,
    direction: "in",
    accountId: defaults.accountId,
    instrument: defaults.instrument,
    date: defaults.date,
    price: "",
    currency: defaults.currency,
    parts: [
      {
        portfolioId: defaults.portfolioId,
        size: defaults.size ? amountInput(defaults.size) : "",
      },
    ],
    charges: [],
    reference: "",
    note: "",
  };
}

// An operation's fields from its parts, one movement per portfolio, with the
// portfolio of each part's holding and each charge added back up across
// the parts.
export function operationFields(
  parts: readonly { movement: Movement; portfolioId: string }[],
  {
    accountId,
    instrument,
    type,
  }: {
    accountId: string;
    instrument: string;
    type: InstrumentType | null;
  },
): MovementFields {
  const [first] = parts;
  if (!first) throw new RangeError("An operation has a part");
  const { movement } = first;
  const charges = new Map<
    string,
    { kind: ChargeKind; label: string; amounts: string[] }
  >();
  for (const charge of parts.flatMap((part) => part.movement.charges)) {
    const key = `${charge.kind}:${charge.label ?? ""}`;
    const item = charges.get(key) ?? {
      kind: charge.kind,
      label: charge.label ?? "",
      amounts: [],
    };
    item.amounts.push(charge.amount);
    charges.set(key, item);
  }
  return {
    kind: movement.kind,
    direction: movement.kind === "adjustment" ? movement.direction : "in",
    accountId,
    instrument,
    date: movement.date,
    price:
      isTrade(movement) && movement.price !== null
        ? amountInput(type ? quotedPrice(type, movement.price) : movement.price)
        : "",
    currency: movement.currency,
    parts: parts.map((part) => ({
      portfolioId: part.portfolioId,
      size: amountInput(
        isTrade(part.movement) ? part.movement.quantity : part.movement.amount,
      ),
    })),
    charges: [...charges.values()].map(({ kind, label, amounts }) => ({
      kind,
      label,
      amount: amountInput(stored(plus(...amounts.map(exactOf)))),
    })),
    reference: movement.reference ?? "",
    note: movement.note ?? "",
  };
}

// An empty text is none.
const optional = (text: string) => (text.trim() === "" ? null : text);

// What the dialog sends: the kind's fields, each part, each charge, the price
// typed as the market quotes it sent per unit. A value the parsers refuse goes
// as null, for the schema to name its field.
export function toOperationInput(
  fields: MovementFields,
  type: InstrumentType | null,
) {
  const perUnit = (typed: string): string | null => {
    const quoted = parseAmountInput(typed);
    if (quoted === null || !type) return quoted;
    return exactUnitPrice(type, quoted) ?? typed;
  };
  const income = isIncome(fields.kind);
  return {
    kind: fields.kind,
    source_connection_id: fields.accountId,
    instrument_symbol: fields.instrument,
    date: fields.date,
    currency: fields.currency,
    ...(income
      ? {}
      : fields.kind === "adjustment"
        ? {
            direction: fields.direction,
            price:
              fields.direction === "in" && fields.price.trim() !== ""
                ? perUnit(fields.price)
                : "0",
          }
        : { price: perUnit(fields.price) }),
    parts: fields.parts.map((part) => ({
      portfolio_id: part.portfolioId,
      [income ? "amount" : "quantity"]: parseAmountInput(part.size),
    })),
    charges: fields.charges.map((charge) => ({
      kind: charge.kind,
      label: optional(charge.label),
      amount: parseAmountInput(charge.amount),
    })),
    reference: optional(fields.reference),
    note: optional(fields.note),
  };
}

export const MOVEMENT_FIELD_MESSAGES: Record<MovementField, string> = {
  kind: "Elegí qué pasó.",
  direction: "Elegí si las unidades entran o salen.",
  account: "Elegí una cuenta.",
  instrument: "Elegí un instrumento.",
  date: "Elegí una fecha.",
  price: "Ingresá un precio de 0 o más.",
  currency: "Elegí una moneda.",
  parts: "Elegí cada cartera una vez, con una cantidad mayor a 0.",
  charges:
    "Cada gasto necesita un monto mayor a 0; un gasto de tipo Otro, un nombre.",
  reference: "La referencia puede tener hasta 40 caracteres.",
  note: "La nota puede tener hasta 200 caracteres.",
};

const FIELD_BY_COLUMN: Record<string, MovementField> = {
  kind: "kind",
  direction: "direction",
  source_connection_id: "account",
  instrument_symbol: "instrument",
  date: "date",
  price: "price",
  currency: "currency",
  parts: "parts",
  charges: "charges",
  reference: "reference",
  note: "note",
};
const FORM_ORDER: readonly MovementField[] = [
  "kind",
  "direction",
  "account",
  "instrument",
  "date",
  "currency",
  "price",
  "parts",
  "charges",
  "reference",
  "note",
];

export function movementRefusal(error: z.ZodError): FieldAlert<MovementField> {
  const first = firstRefused(error, FIELD_BY_COLUMN, FORM_ORDER);
  return first
    ? { field: first.field, text: MOVEMENT_FIELD_MESSAGES[first.field] }
    : { field: null, text: MOVEMENT_MESSAGES.invalid };
}

// The field a refused write's alert is about, when it is about one.
export function refusedMovementField(text: string): MovementField | null {
  if (text === MOVEMENT_MESSAGES.oversold) return "parts";
  if (text === MOVEMENT_MESSAGES.future_date) return "date";
  if (text === MOVEMENT_MESSAGES.no_rate) return "date";
  if (text === MOVEMENT_MESSAGES.opening_balance) return "kind";
  if (text === MOVEMENT_MESSAGES.not_found) return "parts";
  return null;
}
