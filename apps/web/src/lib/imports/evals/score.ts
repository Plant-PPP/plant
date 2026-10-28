import { compareDecimals, currencySchema } from "@plant/shared";
import {
  type DraftOperation,
  type ImportDraft,
  OPERATION_KINDS,
} from "@plant/sources";
import { z } from "zod";

const decimal = z.string().regex(/^\d+(\.\d+)?$/);

// What a test document holds, written by hand next to it in
// evals/local-docs/<name>.expected.json: each holding's symbol, units and
// currency, and the holdings totals the document prints; or, for a document
// of operations, each operation's day, kind (null for one the review names)
// and an adjustment's direction, instrument and units, and how many rows of a log it leaves out.
export const expectedReadingSchema = z
  .object({
    rows: z
      .array(
        z
          .object({
            symbol: z.string().min(1),
            quantity: decimal,
            currency: currencySchema,
          })
          .strict(),
      )
      .default([]),
    operations: z
      .array(
        z
          .object({
            date: z.iso.date(),
            kind: z.enum(OPERATION_KINDS).nullable(),
            direction: z.enum(["in", "out"]).nullable().default(null),
            symbol: z.string().min(1),
            quantity: decimal,
          })
          .strict(),
      )
      .default([]),
    leftOut: z.number().int().min(0).optional(),
    totals: z
      .array(
        z
          .object({
            currency: currencySchema,
            amount: z.string().regex(/^\d+(\.\d+)?$/),
          })
          .strict(),
      )
      .default([])
      .refine(
        (totals) =>
          new Set(totals.map((total) => total.currency)).size === totals.length,
        "One total per currency",
      ),
  })
  .strict()
  .refine(
    (reading) => reading.rows.length + reading.operations.length > 0,
    "A document holds holdings or operations",
  );
export type ExpectedReading = z.infer<typeof expectedReadingSchema>;

const keyOf = (row: { symbol: string; currency: string }) =>
  `${row.symbol.trim().toUpperCase()}|${row.currency}`;

const operationKeyOf = (row: {
  date: string | null;
  kind: string | null;
  direction: string | null;
  symbol: string | null;
}) =>
  `${row.date}|${row.kind ?? "?"}${row.direction ? ` ${row.direction}` : ""}|${row.symbol?.trim().toUpperCase()}`;

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

// Matches expected rows to read ones under one key: exact units first, so a
// low row is not taken for one it is not, then a low row of the key as
// flagged; what is left read is extra.
function matched<E, R extends { confidence: string }>(
  expected: readonly E[],
  read: readonly R[],
  key: (row: E | R) => string,
  same: (want: E, got: R) => boolean,
) {
  const byKey = new Map<string, R[]>();
  for (const row of read) {
    byKey.set(key(row), [...(byKey.get(key(row)) ?? []), row]);
  }
  const unmatched = expected.filter((row) => {
    const candidates = byKey.get(key(row)) ?? [];
    const at = candidates.findIndex((each) => same(row, each));
    if (at === -1) return true;
    candidates.splice(at, 1);
    return false;
  });
  let flagged = 0;
  const wrong: string[] = [];
  for (const row of unmatched) {
    const candidates = byKey.get(key(row)) ?? [];
    const low = candidates.findIndex((each) => each.confidence === "low");
    if (low === -1) {
      wrong.push(key(row));
      continue;
    }
    flagged += 1;
    candidates.splice(low, 1);
  }
  const extra = [...byKey.entries()].flatMap(([each, rows]) =>
    rows.map(() => each),
  );
  return { right: expected.length - unmatched.length, flagged, wrong, extra };
}

export function scoreReading(
  expected: ExpectedReading,
  draft: ImportDraft,
  operations: readonly DraftOperation[] = [],
): ReadingScore {
  const holdings = matched(
    expected.rows,
    draft.rows,
    keyOf,
    (want, got) => compareDecimals(got.quantity, want.quantity) === 0,
  );
  const done = matched(
    expected.operations,
    operations,
    operationKeyOf,
    (want, got) =>
      got.quantity !== null &&
      compareDecimals(got.quantity, want.quantity) === 0,
  );
  const right = holdings.right + done.right;
  const flagged = holdings.flagged + done.flagged;
  const wrong = [...holdings.wrong, ...done.wrong];
  const extra = [...holdings.extra, ...done.extra];
  const wrongTotals = expected.totals.flatMap((total) => {
    const printed = draft.totals.find((t) => t.currency === total.currency);
    return printed && compareDecimals(printed.amount, total.amount) === 0
      ? []
      : [total.currency];
  });
  return {
    rows: expected.rows.length + expected.operations.length,
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
