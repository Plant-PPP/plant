import {
  type ChargeKind,
  type InstrumentType,
  isIncome,
  isTrade,
  takesUnits,
  type Movement,
  type MovementKind,
  MOVEMENT_KINDS,
  exactUnitPrice,
} from "@plant/core";
import { type Currency, exactOf, plus, stored } from "@plant/shared";
import type { z } from "zod";

import type { FieldAlert } from "@/components/portfolio-setup/field-alert";
import { firstRefused } from "@/components/portfolio-setup/refusal";
import { amountInput, parseAmountInput } from "@/lib/format/amount";
import { MOVEMENT_MESSAGES } from "@/lib/holdings/messages";
import { quotedInput } from "@/lib/holdings/price-input";

// One portfolio's part of an operation, as typed: its quantity, or an
// income's amount.
export type PartFields = { portfolioId: string; size: string };
export type ChargeFields = { kind: ChargeKind; label: string; amount: string };

// What the movement dialog holds, as typed. A transfer's first part is the
// portfolio its units leave and its second the one they arrive in, both with
// its quantity; its price is the cost the units arrive with, sent when the
// user changed it (`costEdited`) and left it filled, else they carry the cost
// they had.
export type MovementFields = {
  kind: MovementKind;
  direction: "in" | "out";
  costEdited: boolean;
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
    costEdited: false,
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
  // A transfer lists the side its units leave first.
  const ordered = [...parts].sort(
    (a, b) => Number(takesUnits(b.movement)) - Number(takesUnits(a.movement)),
  );
  const [first] = ordered;
  if (!first) throw new RangeError("An operation has a part");
  const { movement } = first;
  const priced = ordered.at(-1)!.movement;
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
    costEdited: priced.kind === "transfer" && priced.price !== null,
    accountId,
    instrument,
    date: movement.date,
    price:
      isTrade(priced) && priced.price !== null
        ? quotedInput(priced.price, type)
        : "",
    currency: movement.currency,
    parts: ordered.map((part) => ({
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

// The fields as another kind: a transfer takes its quantity out of `from`
// into a portfolio still to choose, with no charges; leaving a transfer keeps
// its first part, and any other change keeps every part.
export function withKind(
  fields: MovementFields,
  kind: MovementKind,
  from: string,
): MovementFields {
  if (kind === "transfer") {
    const size = fields.parts[0]?.size ?? "";
    return {
      ...fields,
      kind,
      price: "",
      costEdited: false,
      charges: [],
      parts: [
        { portfolioId: from, size },
        { portfolioId: "", size },
      ],
    };
  }
  if (fields.kind === "transfer") {
    return {
      ...fields,
      kind,
      price: "",
      costEdited: false,
      parts: fields.parts.slice(0, 1),
    };
  }
  return { ...fields, kind };
}

// The kinds an operation's dialog offers: a transfer only on a new operation
// where the page takes them, and an edited transfer stays one.
export function kindsOffered({
  editing,
  transfers,
}: {
  editing: MovementKind | null;
  transfers: boolean;
}): readonly MovementKind[] {
  if (editing === "transfer") return ["transfer"];
  return MOVEMENT_KINDS.filter(
    (each) => each !== "transfer" || (transfers && editing === null),
  );
}

// An empty text is none.
const optional = (text: string) => (text.trim() === "" ? null : text);

// What the dialog sends: the kind's fields, each part, each charge, the price
// typed as the market quotes it sent per unit. A value the parsers refuse goes
// as null, for the schema to name its field; a transfer's cost the parsers
// refuse goes as typed, since its null carries the units' own.
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
  if (fields.kind === "transfer") {
    const cost =
      fields.costEdited && fields.price.trim() !== ""
        ? (perUnit(fields.price) ?? fields.price)
        : null;
    const quantity = parseAmountInput(fields.parts[0]?.size ?? "");
    return {
      kind: fields.kind,
      source_connection_id: fields.accountId,
      instrument_symbol: fields.instrument,
      date: fields.date,
      currency: fields.currency,
      parts: fields.parts.map((part, index) =>
        index === 0
          ? { portfolio_id: part.portfolioId, direction: "out", quantity }
          : {
              portfolio_id: part.portfolioId,
              direction: "in",
              quantity,
              price: cost,
            },
      ),
      reference: optional(fields.reference),
      note: optional(fields.note),
    };
  }
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
  price: "Ingresá un precio o un costo de 0 o más.",
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
  // A transfer's cost sits on the part its units arrive in.
  const issues = error.issues.map((issue) =>
    issue.path[0] === "parts" && issue.path[2] === "price"
      ? { ...issue, path: ["price"] }
      : issue,
  );
  const first = firstRefused({ issues }, FIELD_BY_COLUMN, FORM_ORDER);
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
  if (text === MOVEMENT_MESSAGES.portfolio_archived) return "parts";
  return null;
}
