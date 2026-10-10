import {
  type Database,
  type ExactMoney,
  compareDecimals,
  currencySchema as currency,
  decimalStringSchema,
  exactOf,
  fieldsPassed,
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

// Every date the holdings date CHECKs allow (1900 to 9999) is an ISO date.
const date = z.iso.date();
const common = columns({
  id: z.string(),
  portfolio_id: z.string(),
  amount: positiveDecimalSchema,
});
const none = z.null();

// The holdings_annual_rate CHECK's bound: 1000% a year.
export const MAX_ANNUAL_RATE = "10";

// Real estate and other: a value the user states, with its date and a label.
const valuedAsset = <C extends "real_estate" | "other">(assetClass: C) =>
  z.object({
    ...common,
    ...columns({
      asset_class: z.literal(assetClass),
      currency,
      valued_on: date,
      label: z.string(),
      instrument_symbol: none,
      annual_rate: none,
      started_on: none,
      matures_on: none,
    }),
  });

// The same rule as the holdings_class_fields CHECK, per class.
export const holdingSchema = z.discriminatedUnion("asset_class", [
  z.object({
    ...common,
    ...columns({
      asset_class: z.literal("instrument"),
      instrument_symbol: z.string(),
      currency: none,
      annual_rate: none,
      started_on: none,
      matures_on: none,
      valued_on: none,
      label: none,
    }),
  }),
  z.object({
    ...common,
    ...columns({
      asset_class: z.literal("cash"),
      currency,
      instrument_symbol: none,
      annual_rate: none,
      started_on: none,
      matures_on: none,
      valued_on: none,
      label: z.string().nullable(),
    }),
  }),
  z
    .object({
      ...common,
      ...columns({
        asset_class: z.literal("fixed_term"),
        currency,
        annual_rate: decimalStringSchema.refine(
          (rate) =>
            compareDecimals(rate, "0") >= 0 &&
            compareDecimals(rate, MAX_ANNUAL_RATE) <= 0,
          {
            message: `A rate is a fraction from 0 to ${MAX_ANNUAL_RATE}`,
            when: fieldsPassed,
          },
        ),
        started_on: date,
        matures_on: date,
        instrument_symbol: none,
        valued_on: none,
        label: z.string().nullable(),
      }),
    })
    .refine((holding) => holding.matures_on > holding.started_on, {
      message: "A fixed term matures after it starts",
      when: fieldsPassed,
    }),
  valuedAsset("real_estate"),
  valuedAsset("other"),
]);
export type Holding = z.output<typeof holdingSchema>;

type HoldingValue =
  | { money: ExactMoney; asOf: string; state?: "matured" | "not_started" }
  | Missing;

const DAY_MS = 86_400_000;
const daysBetween = (from: string, to: string): bigint =>
  BigInt(
    Math.round(
      (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
        DAY_MS,
    ),
  );

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
      n: daysBetween(holding.started_on, end),
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
