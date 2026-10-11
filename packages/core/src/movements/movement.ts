import {
  currencySchema as currency,
  nonNegativeDecimalSchema,
  positiveDecimalSchema,
} from "@plant/shared";
import { z } from "zod";
import { UNIT_FX_KINDS, type UnitFxKind } from "../valuation/denominators";
import { holdingDateSchema } from "../valuation/holding";

// What can happen to an instrument holding. A holding's first movement is its
// opening balance; every other one comes after it.
export const MOVEMENT_KINDS = [
  "opening_balance",
  "purchase",
  "sale",
  "dividend",
  "coupon",
] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];

const INCOME_KINDS: readonly MovementKind[] = ["dividend", "coupon"];

// Money paid to the holder, kept apart from what the holding cost.
export const isIncome = (kind: MovementKind): boolean =>
  INCOME_KINDS.includes(kind);

// Fees and taxes are kept apart from the price, so they never enter the
// average cost.
const charges = {
  date: holdingDateSchema,
  currency,
  fees: nonNegativeDecimalSchema.default("0"),
  taxes: nonNegativeDecimalSchema.default("0"),
};

// Each kind's fields: a trade moves a quantity at a price per unit, income is
// an amount.
const trade = {
  quantity: positiveDecimalSchema,
  price: nonNegativeDecimalSchema,
};
const income = { amount: positiveDecimalSchema };

const KIND_FIELDS = {
  opening_balance: trade,
  purchase: trade,
  sale: trade,
  dividend: income,
  coupon: income,
} as const satisfies Record<MovementKind, z.ZodRawShape>;

// One kind's shape, by the column names a movement is stored under. Callers
// add their own keys with .extend().
export const movementBranch = <K extends MovementKind>(kind: K) =>
  z.object({ kind: z.literal(kind), ...charges, ...KIND_FIELDS[kind] });

// The selling rate of each dollar on the movement's date, so its amounts can
// be expressed in any unit later.
export const movementRatesSchema = z.record(
  z.enum(UNIT_FX_KINDS),
  z.object({ sell: positiveDecimalSchema, date: holdingDateSchema }).strict(),
);
export type MovementRates = z.output<typeof movementRatesSchema>;
export type MovementRate = MovementRates[UnitFxKind];

const stored = {
  id: z.string(),
  holding_id: z.string(),
  rates: movementRatesSchema,
};

export const movementSchema = z.discriminatedUnion("kind", [
  movementBranch("opening_balance").extend(stored).strict(),
  movementBranch("purchase").extend(stored).strict(),
  movementBranch("sale").extend(stored).strict(),
  movementBranch("dividend").extend(stored).strict(),
  movementBranch("coupon").extend(stored).strict(),
]);
export type Movement = z.output<typeof movementSchema>;
export type Trade = Extract<Movement, { quantity: string }>;

export const isTrade = (movement: Movement): movement is Trade =>
  "quantity" in movement;

// Movements apply to instrument holdings only.
export const takesMovements = (holding: { asset_class: string }): boolean =>
  holding.asset_class === "instrument";

// The kinds a holding can take next: its opening balance first, then
// anything else.
export const allowedKinds = (hasMovements: boolean): MovementKind[] =>
  hasMovements
    ? MOVEMENT_KINDS.filter((kind) => kind !== "opening_balance")
    : ["opening_balance"];
