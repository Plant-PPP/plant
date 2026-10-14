import { compareDecimals } from "@plant/shared";
import { DRAFT_ROW_LIMIT, type DraftOperation } from "@plant/sources";

// The fields two readings of an operation must agree on; one they do not is
// left null for the review to ask.
const DECIMALS = ["quantity", "price", "amount", "charges"] as const;
const TEXTS = ["date", "kind", "reference"] as const;

const sameDecimal = (a: string | null, b: string | null) =>
  a === null || b === null ? a === b : compareDecimals(a, b) === 0;

const lowerConfidence = (
  a: DraftOperation["confidence"],
  b: DraftOperation["confidence"],
): DraftOperation["confidence"] => {
  const order = ["low", "medium", "high"] as const;
  return order[Math.min(order.indexOf(a), order.indexOf(b))]!;
};

// An operation's identity across readings: the instrument as printed (none
// when the document does not name it), its currency, and which occurrence it
// is. The date and the kind are fields, so a disagreement on them asks the
// user instead of splitting one operation in two.
function keyed(operations: readonly DraftOperation[]) {
  const seen = new Map<string, number>();
  const out = new Map<string, DraftOperation>();
  for (const operation of operations) {
    const base = `${(operation.symbol ?? "").trim().toUpperCase()}|${operation.currency}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.set(`${base}#${n}`, operation);
  }
  return out;
}

// Merges two readings of a document of operations, in the first reading's
// order. An operation both list keeps each field they agree on and leaves
// null, marked low, any they do not; one only a reading lists is kept, low.
// Nothing is guessed: the review asks for every null.
export function mergeOperations(
  first: readonly DraftOperation[],
  second: readonly DraftOperation[],
): DraftOperation[] {
  const a = keyed(first);
  const b = keyed(second);
  // Operations the readers named differently are paired by their number,
  // else by date, kind and units, so one operation is not listed twice; the
  // name they disagree on is left for the user to choose.
  const leftA = [...a.keys()].filter((key) => !b.has(key));
  const leftB = [...b.keys()].filter((key) => !a.has(key));
  const pairs = new Map<string, string>();
  const same = (
    x: DraftOperation,
    y: DraftOperation,
    by: "reference" | "fields",
  ) =>
    by === "reference"
      ? x.reference !== null && x.reference === y.reference
      : x.date !== null &&
        x.date === y.date &&
        x.kind !== null &&
        x.kind === y.kind &&
        x.quantity !== null &&
        sameDecimal(x.quantity, y.quantity);
  for (const by of ["reference", "fields"] as const) {
    for (const keyA of leftA) {
      if (pairs.has(keyA)) continue;
      const keyB = leftB.find(
        (key) =>
          ![...pairs.values()].includes(key) &&
          same(a.get(keyA)!, b.get(key)!, by),
      );
      if (keyB) pairs.set(keyA, keyB);
    }
  }
  const paired = new Set(pairs.values());
  const merged: DraftOperation[] = [];
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    if (paired.has(key)) continue;
    const x = a.get(key);
    const y =
      b.get(key) ?? (pairs.has(key) ? b.get(pairs.get(key)!) : undefined);
    if (!x || !y) {
      merged.push({ ...(x ?? y)!, confidence: "low" });
      continue;
    }
    let disputed = false;
    const decimals = Object.fromEntries(
      DECIMALS.map((field) => {
        if (sameDecimal(x[field], y[field])) return [field, x[field]];
        disputed = true;
        return [field, null];
      }),
    ) as Pick<DraftOperation, (typeof DECIMALS)[number]>;
    const texts = Object.fromEntries(
      TEXTS.map((field) => {
        if (x[field] === y[field]) return [field, x[field]];
        disputed = true;
        return [field, null];
      }),
    ) as Pick<DraftOperation, (typeof TEXTS)[number]>;
    const symbol = x.symbol === y.symbol ? x.symbol : null;
    if (symbol !== x.symbol) disputed = true;
    // The currency cannot be left empty: the first reading's stands, for the
    // user to check.
    if (x.currency !== y.currency) disputed = true;
    merged.push({
      ...x,
      ...decimals,
      ...texts,
      symbol,
      confidence: disputed
        ? "low"
        : lowerConfidence(x.confidence, y.confidence),
      page: x.page ?? y.page,
    });
  }
  return merged.slice(0, DRAFT_ROW_LIMIT);
}
