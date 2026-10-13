import { classBranch, movementBranch, type OmittableColumn } from "@plant/core";
import {
  compareExact,
  exactOf,
  fieldsPassed,
  nonNegativeDecimalSchema,
  positiveDecimalSchema,
} from "@plant/shared";
import { z } from "zod";

import { NAME_LIMITS } from "@/lib/portfolio-setup/limits";
import { trimmedName } from "@/lib/portfolio-setup/schemas";

import type { AssetClass } from "./messages";

const label = trimmedName(NAME_LIMITS.holdings.label);
const id = z.uuid();

// A new holding: its account, its portfolio and its class's columns, every
// class column explicit (null where the class has none).
const insertBranch = <C extends AssetClass>(assetClass: C) =>
  classBranch(assetClass, { label })
    .extend({ source_connection_id: id, portfolio_id: id })
    .strict();

// An edit: the class stays (a filter), and the account and the instrument
// cannot change. Without a portfolio it stays where it is.
const UPDATE_OMIT = ["instrument_symbol"] as const satisfies OmittableColumn[];
const updateBranch = <C extends AssetClass>(assetClass: C) =>
  classBranch(assetClass, { label, omit: UPDATE_OMIT })
    .extend({ portfolio_id: id.optional() })
    .strict();

export const holdingInsertSchema = z.discriminatedUnion("asset_class", [
  insertBranch("instrument"),
  insertBranch("cash"),
  insertBranch("fixed_term"),
  insertBranch("real_estate"),
  insertBranch("other"),
]);
export type HoldingInsert = z.output<typeof holdingInsertSchema>;

export const holdingUpdateSchema = z.discriminatedUnion("asset_class", [
  updateBranch("instrument"),
  updateBranch("cash"),
  updateBranch("fixed_term"),
  updateBranch("real_estate"),
  updateBranch("other"),
]);
export type HoldingUpdate = z.output<typeof holdingUpdateSchema>;

// An operation as the dialog sends it: one kind of movement of one
// instrument in one account, split across portfolios, each once. A trade's
// part is a quantity and an income's an amount. Charges, reference and note
// are the whole operation's; the store splits the charges across the parts.
const inAccount = {
  source_connection_id: id,
  instrument_symbol: z.string().min(1),
};
// One part per holding: a portfolio appears once in each account, which a
// part names when it is not the operation's (a transfer's arriving side).
const onePerPortfolio = (
  operation: {
    source_connection_id: string;
    parts: readonly { portfolio_id: string; source_connection_id?: string }[];
  },
  context: z.RefinementCtx,
) => {
  const seen = new Set<string>();
  operation.parts.forEach((each, index) => {
    const key = JSON.stringify([
      each.source_connection_id ?? operation.source_connection_id,
      each.portfolio_id,
    ]);
    if (seen.has(key)) {
      context.addIssue({
        code: "custom",
        message: "A portfolio appears once",
        path: ["parts", index, "portfolio_id"],
      });
    }
    seen.add(key);
  });
};
const parts = <S extends z.ZodRawShape>(shape: S) =>
  z
    .array(z.object({ portfolio_id: id, ...shape }).strict())
    .min(1)
    .max(10);

const tradeParts = {
  ...inAccount,
  parts: parts({ quantity: positiveDecimalSchema }),
};
const incomeParts = {
  ...inAccount,
  parts: parts({ amount: positiveDecimalSchema }),
};
// A transfer moves its quantity out of one portfolio's holding and into
// another's, in the same account or, when the arriving side names one,
// another. The side units arrive in may name their cost per unit; without
// one they carry the cost they left with.
const transferParts = {
  ...inAccount,
  parts: z
    .array(
      z.discriminatedUnion("direction", [
        z
          .object({
            portfolio_id: id,
            direction: z.literal("out"),
            quantity: positiveDecimalSchema,
            price: z.null().default(null),
          })
          .strict(),
        z
          .object({
            portfolio_id: id,
            source_connection_id: id.optional(),
            direction: z.literal("in"),
            quantity: positiveDecimalSchema,
            price: nonNegativeDecimalSchema.nullable().default(null),
          })
          .strict(),
      ]),
    )
    .length(2),
};
// One quantity out of one portfolio and into another.
const oneEachWay = (operation: {
  parts: readonly { direction: "in" | "out"; quantity: string }[];
}) => {
  const [first, second] = operation.parts;
  return (
    first !== undefined &&
    second !== undefined &&
    first.direction !== second.direction &&
    compareExact(exactOf(first.quantity), exactOf(second.quantity)) === 0
  );
};

// A yield is one portfolio's: the units it earned or lost, or the balance
// it held at the end of the day, which the store turns into the difference.
const yieldParts = {
  ...inAccount,
  parts: z
    .array(
      z.union([
        z
          .object({
            portfolio_id: id,
            direction: z.enum(["in", "out"]),
            quantity: positiveDecimalSchema,
          })
          .strict(),
        z
          .object({ portfolio_id: id, balance: nonNegativeDecimalSchema })
          .strict(),
      ]),
    )
    .length(1),
};

export const operationInputSchema = z.discriminatedUnion("kind", [
  movementBranch("opening_balance")
    .omit({ quantity: true })
    .extend(tradeParts)
    .strict()
    .superRefine(onePerPortfolio),
  movementBranch("purchase")
    .omit({ quantity: true })
    .extend(tradeParts)
    .strict()
    .superRefine(onePerPortfolio),
  movementBranch("sale")
    .omit({ quantity: true })
    .extend(tradeParts)
    .strict()
    .superRefine(onePerPortfolio),
  movementBranch("dividend")
    .omit({ amount: true })
    .extend(incomeParts)
    .strict()
    .superRefine(onePerPortfolio),
  movementBranch("coupon")
    .omit({ amount: true })
    .extend(incomeParts)
    .strict()
    .superRefine(onePerPortfolio),
  movementBranch("adjustment")
    .omit({ quantity: true })
    .extend(tradeParts)
    .strict()
    .superRefine(onePerPortfolio),
  movementBranch("transfer")
    .omit({ quantity: true, direction: true, price: true, charges: true })
    .extend(transferParts)
    .strict()
    .superRefine(onePerPortfolio)
    .refine(oneEachWay, {
      message:
        "A transfer moves one quantity out of one portfolio into another",
      path: ["parts"],
      when: fieldsPassed,
    }),
  movementBranch("yield")
    .omit({ quantity: true, direction: true, charges: true })
    .extend(yieldParts)
    .strict(),
]);
