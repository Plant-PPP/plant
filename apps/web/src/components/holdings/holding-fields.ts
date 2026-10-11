import {
  HOLDING_DATE_MAX,
  HOLDING_DATE_MIN,
  type Holding,
  holdingSchema,
  MAX_ANNUAL_RATE,
} from "@plant/core";
import type { Currency } from "@plant/shared";
import type { z } from "zod";

import {
  amountInput,
  parseAmountInput,
  percentInput,
  percentToFraction,
} from "@/lib/format/amount";
import type { AssetClass } from "@/lib/holdings/messages";
import type { HoldingRow } from "@/lib/holdings/read";
import type { FieldAlert } from "@/components/portfolio-setup/field-alert";
import { firstRefused } from "@/components/portfolio-setup/refusal";
import { invalidName, WRITE_MESSAGES } from "@/lib/portfolio-setup/messages";
import { NAME_LIMITS } from "@/lib/portfolio-setup/limits";

// The class columns a holding of each class fills; the rest are null.
export const FIELDS_BY_CLASS = {
  instrument: ["instrument_symbol", "amount"],
  cash: ["currency", "amount", "label"],
  fixed_term: [
    "currency",
    "amount",
    "annual_rate",
    "started_on",
    "matures_on",
    "label",
  ],
  real_estate: ["currency", "amount", "valued_on", "label"],
  other: ["currency", "amount", "valued_on", "label"],
} as const satisfies Record<AssetClass, readonly (keyof Holding)[]>;

// The dialog's fields, as typed.
export type HoldingFields = {
  assetClass: AssetClass;
  accountId: string;
  portfolioId: string;
  instrument: string;
  amount: string;
  currency: Currency | "";
  rate: string;
  startedOn: string;
  maturesOn: string;
  valuedOn: string;
  label: string;
};

export function initialFields(
  row: HoldingRow | null,
  defaults: { accountId: string; portfolioId: string; today: string },
): HoldingFields {
  if (!row) {
    return {
      assetClass: "instrument",
      accountId: defaults.accountId,
      portfolioId: defaults.portfolioId,
      instrument: "",
      amount: "",
      currency: "",
      rate: "",
      startedOn: defaults.today,
      maturesOn: "",
      valuedOn: defaults.today,
      label: "",
    };
  }
  const { holding } = row;
  return {
    assetClass: holding.asset_class,
    accountId: row.account.id,
    portfolioId: row.portfolio.id,
    instrument: holding.instrument_symbol ?? "",
    amount: amountInput(holding.amount),
    currency: holding.currency ?? "",
    rate: holding.annual_rate === null ? "" : percentInput(holding.annual_rate),
    startedOn: holding.started_on ?? defaults.today,
    maturesOn: holding.matures_on ?? "",
    valuedOn: holding.valued_on ?? defaults.today,
    label: holding.label ?? "",
  };
}

// What the dialog sends to create the holding: every class column explicit,
// null where the class has none or the user left an optional one empty. A
// value the parsers refuse goes as null, for the schema to name its field.
export function toInsert(fields: HoldingFields) {
  const filled = new Set<string>(FIELDS_BY_CLASS[fields.assetClass]);
  const keep = (column: string, value: string | null) =>
    filled.has(column) ? value : null;
  return {
    asset_class: fields.assetClass,
    source_connection_id: fields.accountId,
    portfolio_id: fields.portfolioId,
    amount: parseAmountInput(fields.amount),
    instrument_symbol: keep("instrument_symbol", fields.instrument || null),
    currency: keep("currency", fields.currency || null),
    annual_rate: keep("annual_rate", percentToFraction(fields.rate)),
    started_on: keep("started_on", fields.startedOn || null),
    matures_on: keep("matures_on", fields.maturesOn || null),
    valued_on: keep("valued_on", fields.valuedOn || null),
    label: keep("label", fields.label.trim() === "" ? null : fields.label),
  };
}

// An edit: the account and the instrument stay, and the portfolio goes only
// when it moved.
export function toUpdate(fields: HoldingFields, portfolioBefore: string) {
  const {
    asset_class,
    portfolio_id,
    amount,
    currency,
    annual_rate,
    started_on,
    matures_on,
    valued_on,
    label,
  } = toInsert(fields);
  const columns = {
    asset_class,
    amount,
    currency,
    annual_rate,
    started_on,
    matures_on,
    valued_on,
    label,
  };
  return portfolio_id === portfolioBefore
    ? columns
    : { ...columns, portfolio_id };
}

// The row the page shows until the server's refresh, built from the fields
// the schema already accepted.
export const holdingRow = (
  id: string,
  fields: HoldingFields,
  chosen: Pick<HoldingRow, "account" | "portfolio">,
): HoldingRow => rowOf(id, toInsert(fields), chosen);

// A holding as the page lists it, from a new holding's columns (parsed here;
// throws on columns the holding schema refuses).
export function rowOf(
  id: string,
  insert: Record<string, unknown>,
  chosen: Pick<HoldingRow, "account" | "portfolio">,
): HoldingRow {
  return {
    id,
    holding: holdingSchema.parse({
      ...insert,
      id,
      portfolio_id: chosen.portfolio.id,
    }),
    ...chosen,
  };
}

export type DialogField =
  | "account"
  | "portfolio"
  | "instrument"
  | "amount"
  | "currency"
  | "rate"
  | "startedOn"
  | "maturesOn"
  | "valuedOn"
  | "label";

const MESSAGES = WRITE_MESSAGES.holdings;

const FIELD_BY_COLUMN: Record<string, DialogField> = {
  source_connection_id: "account",
  portfolio_id: "portfolio",
  instrument_symbol: "instrument",
  amount: "amount",
  currency: "currency",
  annual_rate: "rate",
  started_on: "startedOn",
  matures_on: "maturesOn",
  valued_on: "valuedOn",
  label: "label",
};

const DATE_MESSAGE = `Usá una fecha entre ${HOLDING_DATE_MIN.slice(0, 4)} y ${HOLDING_DATE_MAX.slice(0, 4)}.`;

// What the dialog says about each field it refuses.
export const FIELD_MESSAGES: Record<DialogField, string> = {
  account: "Elegí una cuenta.",
  portfolio: "Elegí una cartera.",
  instrument: "Elegí un instrumento.",
  amount:
    "Ingresá un número mayor a cero, con coma para los decimales: 1234,56.",
  currency: "Elegí una moneda.",
  rate: `La TNA va de 0 a ${percentInput(MAX_ANNUAL_RATE)}%, con coma para los decimales: 35,5.`,
  startedOn: DATE_MESSAGE,
  maturesOn: DATE_MESSAGE,
  valuedOn: DATE_MESSAGE,
  label: invalidName(NAME_LIMITS.holdings.label),
};

export const MATURITY_MESSAGE =
  "El vencimiento tiene que ser posterior al inicio.";

// A date the user left empty.
const MISSING_DATE: Partial<Record<DialogField, string>> = {
  startedOn: "Elegí la fecha de inicio.",
  maturesOn: "Elegí la fecha de vencimiento.",
  valuedOn: "Elegí la fecha de la valuación.",
};

// The fields in the order the dialog shows them.
const FORM_ORDER: readonly DialogField[] = [
  "account",
  "portfolio",
  "instrument",
  "currency",
  "amount",
  "rate",
  "startedOn",
  "maturesOn",
  "valuedOn",
  "label",
];

// The refused field the dialog shows first, with its alert. The rule across a
// fixed term's dates has no path; it is about the maturity.
export function refusal(error: z.ZodError): FieldAlert<DialogField> {
  const first = firstRefused(error, FIELD_BY_COLUMN, FORM_ORDER);
  if (!first) return { field: "maturesOn", text: MATURITY_MESSAGE };
  const missing = first.empty ? MISSING_DATE[first.field] : undefined;
  return { field: first.field, text: missing ?? FIELD_MESSAGES[first.field] };
}

// The field a refused write's alert is about; none for an alert about the
// write itself. An edit keeps its instrument, so a duplicate there is about
// the portfolio it moved to.
export function refusedField(
  mode: "create" | "edit",
  text: string,
): DialogField | null {
  if (text === MESSAGES.duplicate) {
    return mode === "create" ? "instrument" : "portfolio";
  }
  if (text === MESSAGES.source_connection_archived) return "account";
  if (text === MESSAGES.portfolio_archived) return "portfolio";
  return null;
}
