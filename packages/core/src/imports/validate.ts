import {
  compareExact,
  decimalStringSchema,
  type Exact,
  exactOf,
  minus,
  over,
  roundedTo,
  times,
} from "@plant/shared";

import type { PricingBasis } from "../instruments";

export const IMPORT_ISSUES = ["value_mismatch", "duplicate_symbol"] as const;
export type ImportIssue = (typeof IMPORT_ISSUES)[number];

// A row as the document printed it: `price` per `basis` units (a bond's per
// 100 nominal), `value` the row's total.
export type ValidatedRow = {
  symbol: string;
  quantity: string;
  price: string | null;
  value: string | null;
  basis: PricingBasis;
};

const CENT: Exact = { n: 1n, d: 100n };

const isDecimal = (text: string) => decimalStringSchema.safeParse(text).success;

const magnitude = (x: Exact): Exact => (x.n < 0n ? { n: -x.n, d: x.d } : x);

// Quantity × price, rounded to cents, may miss the printed value by a cent, or
// by the half of the price's last printed digit the broker rounded away.
function valueMismatches(row: ValidatedRow): boolean {
  const { quantity, price, value } = row;
  if (price === null || value === null) return false;
  if (![quantity, price, value].every(isDecimal)) return false;
  const basis: Exact = { n: BigInt(row.basis), d: 1n };
  const q = exactOf(quantity);
  const computed = roundedTo(over(times(q, exactOf(price)), basis), 2);
  const digits = price.split(".")[1]?.length ?? 0;
  const halfDigit: Exact = { n: 1n, d: 2n * 10n ** BigInt(digits) };
  const slack = over(times(magnitude(q), halfDigit), basis);
  const tolerance = compareExact(slack, CENT) > 0 ? slack : CENT;
  return (
    compareExact(magnitude(minus(computed, exactOf(value))), tolerance) > 0
  );
}

// Each row's issues, in the rows' order. A blank symbol is not yet chosen, so
// it never repeats.
export function validateHoldings(
  rows: readonly ValidatedRow[],
): ImportIssue[][] {
  const counts = new Map<string, number>();
  for (const { symbol } of rows) {
    if (symbol !== "") counts.set(symbol, (counts.get(symbol) ?? 0) + 1);
  }
  return rows.map((row) => {
    const issues: ImportIssue[] = [];
    if (valueMismatches(row)) issues.push("value_mismatch");
    if ((counts.get(row.symbol) ?? 0) > 1) issues.push("duplicate_symbol");
    return issues;
  });
}

const OLDEST_DOCUMENT_DATE = "1990-01-01";

// A document's date (YYYY-MM-DD) when it cannot be right: after `today` or
// before OLDEST_DOCUMENT_DATE.
export function documentDateIssue(
  date: string | null,
  today: string,
): "future" | "old" | null {
  if (date === null) return null;
  if (date > today) return "future";
  return date < OLDEST_DOCUMENT_DATE ? "old" : null;
}
