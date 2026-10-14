import { compareDecimals, currencySchema } from "@plant/shared";
import type { ImportDraft } from "@plant/sources";
import { z } from "zod";

// What a test document holds, written by hand next to it in
// evals/local-docs/<name>.expected.json: each holding's symbol, units and
// currency, and the holdings totals the document prints.
export const expectedReadingSchema = z
  .object({
    rows: z
      .array(
        z
          .object({
            symbol: z.string().min(1),
            quantity: z.string().regex(/^\d+(\.\d+)?$/),
            currency: currencySchema,
          })
          .strict(),
      )
      .min(1),
    totals: z
      .array(
        z
          .object({
            currency: currencySchema,
            amount: z.string().regex(/^\d+(\.\d+)?$/),
          })
          .strict(),
      )
      .default([]),
  })
  .strict();
export type ExpectedReading = z.infer<typeof expectedReadingSchema>;

const keyOf = (row: { symbol: string; currency: string }) =>
  `${row.symbol.trim().toUpperCase()}|${row.currency}`;

// How a reading did against a document's expected holdings. A row is right
// when the reading lists its symbol and currency with the same units, or
// flagged when the reading lists it with other units but marks it low, for
// the user to check; anything else is wrong. A total is right when the
// reading prints the same amount.
export type ReadingScore = {
  rows: number;
  right: number;
  flagged: number;
  wrong: string[];
  extra: string[];
  totals: number;
  totalsRight: number;
  wrongTotals: string[];
};

export function scoreReading(
  expected: ExpectedReading,
  draft: ImportDraft,
): ReadingScore {
  const read = new Map<string, ImportDraft["rows"][number][]>();
  for (const row of draft.rows) {
    read.set(keyOf(row), [...(read.get(keyOf(row)) ?? []), row]);
  }
  let right = 0;
  let flagged = 0;
  const wrong: string[] = [];
  for (const row of expected.rows) {
    const candidates = read.get(keyOf(row)) ?? [];
    const same = candidates.findIndex(
      (each) => compareDecimals(each.quantity, row.quantity) === 0,
    );
    if (same !== -1) {
      right += 1;
      candidates.splice(same, 1);
      continue;
    }
    const low = candidates.findIndex((each) => each.confidence === "low");
    if (low !== -1) {
      flagged += 1;
      candidates.splice(low, 1);
      continue;
    }
    wrong.push(keyOf(row));
  }
  const extra = [...read.entries()].flatMap(([key, rows]) =>
    rows.map(() => key),
  );
  const wrongTotals = expected.totals.flatMap((total) => {
    const printed = draft.totals.find((t) => t.currency === total.currency);
    return printed && compareDecimals(printed.amount, total.amount) === 0
      ? []
      : [total.currency];
  });
  return {
    rows: expected.rows.length,
    right,
    flagged,
    wrong,
    extra,
    totals: expected.totals.length,
    totalsRight: expected.totals.length - wrongTotals.length,
    wrongTotals,
  };
}

// The stage's bar over a set of documents: 95% of the rows right or flagged,
// and every total the documents print right.
export function meetsTheBar(scores: readonly ReadingScore[]) {
  const rows = scores.reduce((sum, s) => sum + s.rows, 0);
  const good = scores.reduce((sum, s) => sum + s.right + s.flagged, 0);
  const totals = scores.reduce((sum, s) => sum + s.totals, 0);
  const totalsRight = scores.reduce((sum, s) => sum + s.totalsRight, 0);
  return {
    rowShare: rows === 0 ? 1 : good / rows,
    totalsAllRight: totalsRight === totals,
    passes: rows > 0 && good / rows >= 0.95 && totalsRight === totals,
  };
}
