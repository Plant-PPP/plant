import { type Movement, takesUnits } from "./movement";

// Below every entry order, which is never negative.
const OPENING_RANK = -1;

// Within a day, the opening balance comes first (it is what was held before
// the day) and the rest go in the order their operations were entered.
function rankOf(movement: Movement): number {
  return movement.kind === "opening_balance"
    ? OPENING_RANK
    : movement.entry_order;
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

// The order movements are replayed in across several holdings: as
// compareMovements, except that within one operation a transfer's units leave
// before they arrive, so the side they arrive in can carry their cost.
export function compareInReplay(a: Movement, b: Movement): number {
  if (a.operation_id === b.operation_id && takesUnits(a) !== takesUnits(b)) {
    return takesUnits(a) ? -1 : 1;
  }
  return compareMovements(a, b);
}
