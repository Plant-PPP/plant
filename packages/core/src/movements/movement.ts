import {
  currencySchema as currency,
  fieldsPassed,
  nonNegativeDecimalSchema,
  positiveDecimalSchema,
} from "@plant/shared";
import { z } from "zod";
import { UNIT_FX_KINDS, type UnitFxKind } from "../valuation/denominators";
import { holdingDateSchema } from "../valuation/holding";

// What can happen to an instrument holding. A holding starts with units
// coming in: its opening balance, or a purchase. An adjustment changes the
// quantity without trading it: units in at a cost (0 unless given), or units
// out with their share of the cost and no result.
export const MOVEMENT_KINDS = [
  "opening_balance",
  "purchase",
  "sale",
  "dividend",
  "coupon",
  "adjustment",
] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];

const INCOME_KINDS: readonly MovementKind[] = ["dividend", "coupon"];

// Money paid to the holder, kept apart from what the holding cost.
export const isIncome = (kind: MovementKind): boolean =>
  INCOME_KINDS.includes(kind);

// What an operation was charged, item by item as the broker lists it. Charges
// never enter the average cost.
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
    // A tax may say which; any other charge must.
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
const KIND_FIELDS = {
  opening_balance: trade,
  purchase: trade,
  sale: trade,
  dividend: { amount: positiveDecimalSchema },
  coupon: { amount: positiveDecimalSchema },
  adjustment: {
    direction: z.enum(["in", "out"]),
    quantity: positiveDecimalSchema,
    // The cost of each unit that comes in; units that go out take theirs.
    price: nonNegativeDecimalSchema.default("0"),
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
// parts are the same purchase or sale in the account's other portfolios.
const stored = {
  id: z.string(),
  holding_id: z.string(),
  operation_id: z.string(),
  rates: movementRatesSchema,
};

export const movementSchema = z.discriminatedUnion("kind", [
  movementBranch("opening_balance").extend(stored).strict(),
  movementBranch("purchase").extend(stored).strict(),
  movementBranch("sale").extend(stored).strict(),
  movementBranch("dividend").extend(stored).strict(),
  movementBranch("coupon").extend(stored).strict(),
  movementBranch("adjustment").extend(stored).strict(),
]);
export type Movement = z.output<typeof movementSchema>;
// A movement that moves units.
export type Trade = Extract<Movement, { quantity: string }>;

export const isTrade = (movement: Movement): movement is Trade =>
  "quantity" in movement;

// Whether a movement takes units out: a sale, or an adjustment out.
export const takesUnits = (movement: Movement): boolean =>
  movement.kind === "sale" ||
  (movement.kind === "adjustment" && movement.direction === "out");

// Movements apply to instrument holdings only.
export const takesMovements = (holding: { asset_class: string }): boolean =>
  holding.asset_class === "instrument";

// The kinds a holding can take next: units coming in first (its opening
// balance, or a purchase), then anything but an opening balance.
export const allowedKinds = (hasMovements: boolean): MovementKind[] =>
  hasMovements
    ? MOVEMENT_KINDS.filter((kind) => kind !== "opening_balance")
    : ["opening_balance", "purchase"];
