import { compareDecimals } from "@plant/shared";
import { DRAFT_DEBT_LIMIT, type DraftDebt } from "@plant/sources";

const sameDecimal = (a: string | null, b: string | null) =>
  a === null || b === null ? a === b : compareDecimals(a, b) === 0;

// A debt's identity across readings: its kind and unit, and which occurrence
// it is.
function keyed(debts: readonly DraftDebt[]) {
  const seen = new Map<string, number>();
  const out = new Map<string, DraftDebt>();
  for (const debt of debts) {
    const unit = `${debt.kind ?? "card"}:${debt.currency ?? debt.instrumentSymbol}`;
    const n = seen.get(unit) ?? 0;
    seen.set(unit, n + 1);
    out.set(`${unit}#${n}`, debt);
  }
  return out;
}

// Merges two readings of a card or loan statement, in the first reading's
// order. A debt both list keeps each figure, date, rate and accrual they
// agree on and leaves null, marked low, any they do not; the debt's name and
// lender are the first reading's, the second's where the first has none. A debt only one reading
// lists is kept, low. `cut` counts the debts past DRAFT_DEBT_LIMIT left out.
export function mergeDebts(
  first: readonly DraftDebt[],
  second: readonly DraftDebt[],
): { rows: DraftDebt[]; cut: number } {
  const a = keyed(first);
  const b = keyed(second);
  const merged: DraftDebt[] = [];
  for (const [key, one] of a) {
    const two = b.get(key);
    if (!two) {
      merged.push({ ...one, confidence: "low" });
      continue;
    }
    const agree = {
      balance: sameDecimal(one.balance, two.balance),
      minimumPayment: sameDecimal(one.minimumPayment, two.minimumPayment),
      dueDate: one.dueDate === two.dueDate,
      annualRate: sameDecimal(one.annualRate, two.annualRate),
      accrues: one.accrues === two.accrues,
      openedOn: one.openedOn === two.openedOn,
    };
    const balance = agree.balance ? one.balance : null;
    const minimumPayment = agree.minimumPayment ? one.minimumPayment : null;
    const dueDate = agree.dueDate ? one.dueDate : null;
    // A figure only one reading printed is a disagreement too.
    const disputed = Object.values(agree).some((each) => !each);
    const order = ["low", "medium", "high"] as const;
    merged.push({
      kind: one.kind,
      label: one.label ?? two.label,
      lender: one.lender ?? two.lender,
      currency: one.currency,
      instrumentSymbol: one.instrumentSymbol,
      balance,
      minimumPayment,
      dueDate,
      annualRate: agree.annualRate ? one.annualRate : null,
      accrues: agree.accrues ? one.accrues : null,
      openedOn: agree.openedOn ? one.openedOn : null,
      confidence: disputed
        ? "low"
        : order[
            Math.min(
              order.indexOf(one.confidence),
              order.indexOf(two.confidence),
            )
          ]!,
      page: one.page ?? two.page,
    });
  }
  for (const [key, two] of b) {
    if (!a.has(key)) merged.push({ ...two, confidence: "low" });
  }
  return {
    rows: merged.slice(0, DRAFT_DEBT_LIMIT),
    cut: Math.max(merged.length - DRAFT_DEBT_LIMIT, 0),
  };
}
