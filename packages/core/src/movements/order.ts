import { isIncome, type Movement, takesUnits } from "./movement";

// Within a day, the opening balance comes first and what takes units out
// last, so a sale can use what was bought that same day.
function rankOf(movement: Movement): number {
  if (movement.kind === "opening_balance") return 0;
  if (takesUnits(movement)) return 3;
  if (isIncome(movement.kind)) return 2;
  return 1;
}

// Where a movement sits in a holding's history, and the cursor a page of
// movements resumes after.
export type MovementCursor = { date: string; rank: number; id: string };

export const movementKey = (movement: Movement): MovementCursor => ({
  date: movement.date,
  rank: rankOf(movement),
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
