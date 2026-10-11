import {
  classBranch,
  type MovementKind,
  movementBranch,
  type OmittableColumn,
} from "@plant/core";
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

// A new or edited movement: its holding and its kind's columns. Its rates are
// the store's to add, from the quotes of its date.
const movementInputBranch = <K extends MovementKind>(kind: K) =>
  movementBranch(kind).extend({ holding_id: id }).strict();

export const movementInputSchema = z.discriminatedUnion("kind", [
  movementInputBranch("opening_balance"),
  movementInputBranch("purchase"),
  movementInputBranch("sale"),
  movementInputBranch("dividend"),
  movementInputBranch("coupon"),
]);
export type MovementInput = z.output<typeof movementInputSchema>;
