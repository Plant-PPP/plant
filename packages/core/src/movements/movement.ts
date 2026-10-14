import {
  Constants,
  currencySchema as currency,
  type Exact,
  exactOf,
  fieldsPassed,
  negated,
  nonNegativeDecimalSchema,
  positiveDecimalSchema,
  ZERO,
} from "@plant/shared";
import { z } from "zod";
import { UNIT_FX_KINDS, type UnitFxKind } from "../valuation/denominators";
import { holdingDateSchema } from "../valuation/holding";

// What can happen to an instrument holding. A holding starts with units
// coming in: its opening balance, a purchase, an adjustment in or a transfer
// in. An adjustment changes the quantity without trading it: units in at a
// cost (0 unless given), or units out with the cost of the oldest units and
// no result. A transfer moves units between two of the user's portfolios:
// the oldest leave with their cost and arrive carrying it, with no result. A
// fee for it is a charge of the side they leave, an expense apart from the
// cost.
// A yield is units a holding earned or lost without money in or out (staking,
// earn, trading): their value that day is the holding's return. It never
// starts a holding.
export const MOVEMENT_KINDS = Constants.public.Enums.movement_kind;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];

const INCOME_KINDS: readonly MovementKind[] = ["dividend", "coupon"];

// Money paid to the user, kept apart from what the holding cost.
export const isIncome = (kind: MovementKind): boolean =>
  INCOME_KINDS.includes(kind);

// What an operation was charged, item by item as the broker lists it. Charges
// never enter the cost.
export const CHARGE_KINDS = [
  "commission",
  "market_fee",
  "vat",
  "tax",
  "other",
] as const;
export type ChargeKind = (typeof CHARGE_KINDS)[number];

export const CHARGE_LABEL_MAX = 40;
export const REFERENCE_MAX = 40;
export const NOTE_MAX = 200;

const trimmed = (max: number) => z.string().trim().min(1).max(max);

export const chargeSchema = z
  .object({
    kind: z.enum(CHARGE_KINDS),
    // Only an "other" charge must say what it is; a tax may say which.
    label: trimmed(CHARGE_LABEL_MAX).nullable(),
    amount: positiveDecimalSchema,
  })
  .strict()
  .refine((charge) => charge.kind !== "other" || charge.label !== null, {
    message: "Another charge needs a name",
    path: ["label"],
    when: fieldsPassed,
  });
export type Charge = z.output<typeof chargeSchema>;

// The fields every movement has: its date and currency, its charges, and the
// broker's reference and a note, both optional.
const common = {
  date: holdingDateSchema,
  currency,
  charges: z.array(chargeSchema).max(10).default([]),
  reference: trimmed(REFERENCE_MAX).nullable().default(null),
  note: trimmed(NOTE_MAX).nullable().default(null),
};

// Each kind's fields: a trade moves a quantity at a price per unit, income is
// an amount, and an adjustment moves units in or out.
const trade = {
  quantity: positiveDecimalSchema,
  price: nonNegativeDecimalSchema,
};
// Units moved in or out without a trade.
const moved = {
  direction: z.enum(Constants.public.Enums.movement_direction),
  quantity: positiveDecimalSchema,
};
const KIND_FIELDS = {
  opening_balance: trade,
  purchase: trade,
  sale: trade,
  dividend: { amount: positiveDecimalSchema },
  coupon: { amount: positiveDecimalSchema },
  adjustment: {
    ...moved,
    // The cost of each unit that comes in; units that go out take theirs.
    price: nonNegativeDecimalSchema.default("0"),
  },
  transfer: {
    ...moved,
    // The cost of each unit that comes in, when the user sets one; null
    // carries the cost the units left with. Units that go out take theirs.
    price: nonNegativeDecimalSchema.nullable().default(null),
  },
  yield: {
    ...moved,
    // What each unit was worth that day.
    price: nonNegativeDecimalSchema,
    charges: z.tuple([]).default([]),
  },
} as const satisfies Record<MovementKind, z.ZodRawShape>;

// One kind's shape, by the column names a movement is stored under. Callers
// add their own keys with .extend().
export const movementBranch = <K extends MovementKind>(kind: K) =>
  z.object({ kind: z.literal(kind), ...common, ...KIND_FIELDS[kind] });

// The selling rate of each dollar on the movement's date, so its amounts can
// be expressed in any unit later.
export const movementRatesSchema = z.record(
  z.enum(UNIT_FX_KINDS),
  z.object({ sell: positiveDecimalSchema, date: holdingDateSchema }).strict(),
);
export type MovementRates = z.output<typeof movementRatesSchema>;
export type MovementRate = MovementRates[UnitFxKind];

// A movement is one holding's part of an operation: the operation's other
// parts are the same movement in the account's other portfolios, or a
// transfer's other side.
// Every part shares its operation's entry order, which orders the movements
// of one day after any opening balance.
const stored = {
  id: z.string(),
  holding_id: z.string(),
  operation_id: z.string(),
  entry_order: z.number().int().nonnegative(),
  rates: movementRatesSchema,
};

export const movementSchema = z.discriminatedUnion("kind", [
  movementBranch("opening_balance").extend(stored).strict(),
  movementBranch("purchase").extend(stored).strict(),
  movementBranch("sale").extend(stored).strict(),
  movementBranch("dividend").extend(stored).strict(),
  movementBranch("coupon").extend(stored).strict(),
  movementBranch("adjustment").extend(stored).strict(),
  movementBranch("transfer")
    .extend(stored)
    .strict()
    .refine(
      (movement) => movement.direction === "in" || movement.price === null,
      { message: "Units going out carry their own cost", path: ["price"] },
    )
    .refine(
      (movement) =>
        movement.direction === "out" || movement.charges.length === 0,
      { message: "Only the side units leave pays the fee", path: ["charges"] },
    ),
  movementBranch("yield").extend(stored).strict(),
]);
export type Movement = z.output<typeof movementSchema>;
// A movement that moves units.
export type Trade = Extract<Movement, { quantity: string }>;

export const isTrade = (movement: Movement): movement is Trade =>
  "quantity" in movement;

// Whether a movement takes units out: a sale, or an adjustment, transfer or
// yield out.
export const takesUnits = (movement: Movement): boolean =>
  movement.kind === "sale" ||
  ("direction" in movement && movement.direction === "out");

// The units a movement brings in (positive) or takes out (negative).
export const unitsMoved = (movement: Movement): Exact => {
  if (!isTrade(movement)) return ZERO;
  const moved = exactOf(movement.quantity);
  return takesUnits(movement) ? negated(moved) : moved;
};

// Movements apply to instrument holdings only.
export const takesMovements = (holding: { asset_class: string }): boolean =>
  holding.asset_class === "instrument";

export const isYield = (
  movement: Movement,
): movement is Extract<Movement, { kind: "yield" }> =>
  movement.kind === "yield";

// Whether a movement can be a holding's first: one that brings units in, other
// than a yield, which only a holding that exists can earn.
export const startsHolding = (movement: Movement): boolean =>
  isTrade(movement) && !takesUnits(movement) && !isYield(movement);
