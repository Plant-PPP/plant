import {
  type Database,
  type ExactMoney,
  compareDecimals,
  daysBetween,
  currencySchema as currency,
  exactOf,
  fieldsPassed,
  nonNegativeDecimalSchema,
  plus,
  positiveDecimalSchema,
  roundedTo,
  times,
} from "@plant/shared";
import { z } from "zod";
import type { QuoteSnapshot } from "../quotes/contract/quote";
import { type ReferenceDollar, type Value, express } from "./denominator";
import type { Denominator } from "./denominators";
import { type Missing, priceOf } from "./snapshot";

type HoldingRow = Database["public"]["Tables"]["holdings"]["Row"];
type AssetClass = HoldingRow["asset_class"];

// A shape for some of a holding's columns, by the column names the database
// generates. Amounts are decimal strings (read as text), never numbers.
const columns = <
  S extends { [K in keyof S]: K extends keyof HoldingRow ? z.ZodType : never },
>(
  shape: S,
) => shape;

// The holdings_dates_in_range CHECK's bounds.
export const HOLDING_DATE_MIN = "1900-01-01";
export const HOLDING_DATE_MAX = "9999-12-31";

export const holdingDateSchema = z.iso
  .date()
  .refine((day) => day >= HOLDING_DATE_MIN && day <= HOLDING_DATE_MAX, {
    message: `A date from ${HOLDING_DATE_MIN} to ${HOLDING_DATE_MAX}`,
  });
const common = columns({ id: z.string(), portfolio_id: z.string() });
const none = z.null();

// The holdings_annual_rate CHECK's bound: 1000% a year.
export const MAX_ANNUAL_RATE = "10";

const annualRate = nonNegativeDecimalSchema.refine(
  (rate) => compareDecimals(rate, MAX_ANNUAL_RATE) <= 0,
  {
    message: `A rate is a fraction from 0 to ${MAX_ANNUAL_RATE}`,
    when: fieldsPassed,
  },
);

type Label = z.ZodType<string, string>;

// The columns whose shape depends on the class, as the holdings_class_fields
// CHECK sets them. The label schema is the caller's: a read takes any string,
// a write the name rule.
const classColumns = <L extends Label>(label: L) => ({
  instrument: columns({
    instrument_symbol: z.string(),
    currency: none,
    annual_rate: none,
    started_on: none,
    matures_on: none,
    valued_on: none,
    label: none,
  }),
  cash: columns({
    currency,
    instrument_symbol: none,
    annual_rate: none,
    started_on: none,
    matures_on: none,
    valued_on: none,
    label: label.nullable(),
  }),
  fixed_term: columns({
    currency,
    annual_rate: annualRate,
    started_on: holdingDateSchema,
    matures_on: holdingDateSchema,
    instrument_symbol: none,
    valued_on: none,
    label: label.nullable(),
  }),
  // A value the user states, with its date and a label.
  real_estate: columns({
    currency,
    valued_on: holdingDateSchema,
    label,
    instrument_symbol: none,
    annual_rate: none,
    started_on: none,
    matures_on: none,
  }),
  other: columns({
    currency,
    valued_on: holdingDateSchema,
    label,
    instrument_symbol: none,
    annual_rate: none,
    started_on: none,
    matures_on: none,
  }),
});
type ClassColumns<L extends Label> = ReturnType<typeof classColumns<L>>;
type ClassColumn = keyof ClassColumns<Label>[AssetClass];
// The fixed-term refine reads both dates, so neither can be left out.
export type OmittableColumn = Exclude<ClassColumn, "started_on" | "matures_on">;

type Branch<
  C extends AssetClass,
  L extends Label,
  O extends PropertyKey,
> = z.ZodObject<
  Omit<ClassColumns<L>[C], O> & {
    asset_class: z.ZodLiteral<C>;
    amount: typeof positiveDecimalSchema;
  }
>;

type Term = { started_on: string; matures_on: string };
const maturesAfterStart = (holding: Term) =>
  holding.matures_on > holding.started_on;

// One class's shape, with its rule across columns. Callers add their own keys
// with .extend() (only keys the branch lacks: zod refuses to overwrite a key on
// a refined object) and make it .strict() where unknown keys must be refused.
export function classBranch<
  C extends AssetClass,
  L extends Label = z.ZodString,
  O extends OmittableColumn = never,
>(
  assetClass: C,
  options: { label?: L; omit?: readonly O[] } = {},
): Branch<C, L, O> {
  const omit: readonly PropertyKey[] = options.omit ?? [];
  const shape = Object.fromEntries(
    Object.entries(
      classColumns(options.label ?? z.string())[assetClass],
    ).filter(([column]) => !omit.includes(column)),
  );
  const branch = z.object({
    ...shape,
    asset_class: z.literal(assetClass),
    amount: positiveDecimalSchema,
  });
  if (assetClass !== "fixed_term") return branch as unknown as Branch<C, L, O>;
  return branch.refine(
    (holding) => maturesAfterStart(holding as unknown as Term),
    { message: "A fixed term matures after it starts", when: fieldsPassed },
  ) as unknown as Branch<C, L, O>;
}

// The same rule as the holdings_class_fields CHECK, per class.
export const holdingSchema = z.discriminatedUnion("asset_class", [
  classBranch("instrument").extend(common),
  classBranch("cash").extend(common),
  classBranch("fixed_term").extend(common),
  classBranch("real_estate").extend(common),
  classBranch("other").extend(common),
]);
export type Holding = z.output<typeof holdingSchema>;

type HoldingValue =
  | { money: ExactMoney; asOf: string; state?: "matured" | "not_started" }
  | Missing;

const statedValue = (
  holding: Extract<Holding, { asset_class: "real_estate" | "other" }>,
): HoldingValue => ({
  money: { amount: exactOf(holding.amount), currency: holding.currency },
  asOf: holding.valued_on,
});

type Valuer<C extends AssetClass> = (
  holding: Extract<Holding, { asset_class: C }>,
  snapshot: QuoteSnapshot,
) => HoldingValue;

const VALUERS: { [C in AssetClass]: Valuer<C> } = {
  instrument: (holding, snapshot) => {
    const price = priceOf(holding.instrument_symbol, snapshot);
    if ("missing" in price) return price;
    return {
      money: {
        amount: times(exactOf(holding.amount), price.money.amount),
        currency: price.money.currency,
      },
      asOf: price.date,
    };
  },
  cash: (holding, snapshot) => ({
    money: { amount: exactOf(holding.amount), currency: holding.currency },
    asOf: snapshot.date,
  }),
  // Simple interest, actual/365, credited in cents: the one rounding before a
  // value is shown.
  fixed_term: (holding, snapshot) => {
    const principal = exactOf(holding.amount);
    if (snapshot.date < holding.started_on) {
      return {
        money: { amount: principal, currency: holding.currency },
        asOf: snapshot.date,
        state: "not_started",
      };
    }
    const matured = snapshot.date >= holding.matures_on;
    const end = matured ? holding.matures_on : snapshot.date;
    const interest = times(times(principal, exactOf(holding.annual_rate)), {
      n: BigInt(daysBetween(holding.started_on, end)),
      d: 365n,
    });
    return {
      money: {
        amount: plus(principal, roundedTo(interest, 2)),
        currency: holding.currency,
      },
      asOf: matured ? holding.matures_on : snapshot.date,
      ...(matured && { state: "matured" as const }),
    };
  },
  real_estate: (holding) => statedValue(holding),
  other: (holding) => statedValue(holding),
};

// A holding in the currency it is held in.
export function valueHolding(
  holding: Holding,
  snapshot: QuoteSnapshot,
): HoldingValue {
  const valuer = VALUERS[holding.asset_class] as Valuer<AssetClass>;
  return valuer(holding as never, snapshot);
}

// One unit of a priced instrument in a view: the numerator of a preview such
// as "1 ETH in pesos".
export function instrumentValue(
  symbol: string,
  view: Denominator,
  snapshot: QuoteSnapshot,
  referenceDollar: ReferenceDollar,
): { value: Value; asOf: string } | Missing {
  const price = priceOf(symbol, snapshot);
  if ("missing" in price) return price;
  return express(price.money, price.date, view, snapshot, referenceDollar);
}
