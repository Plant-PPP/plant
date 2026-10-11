import type { Movement, MovementKind } from "./movement";

// Within a day, the opening balance comes first and sales last, so a sale can
// use what was bought that same day.
const RANK: Record<MovementKind, number> = {
  opening_balance: 0,
  purchase: 1,
  dividend: 2,
  coupon: 2,
  sale: 3,
};

// Where a movement sits in a holding's history, and the cursor a page of
// movements resumes after.
export type MovementCursor = { date: string; rank: number; id: string };

export const movementKey = (movement: Movement): MovementCursor => ({
  date: movement.date,
  rank: RANK[movement.kind],
  id: movement.id,
});

export function compareKeys(a: MovementCursor, b: MovementCursor): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.rank !== b.rank) return a.rank - b.rank;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// Oldest first: the order a position is built in. Lists show it reversed.
export const compareMovements = (a: Movement, b: Movement): number =>
  compareKeys(movementKey(a), movementKey(b));
