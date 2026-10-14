import { exactUnitPrice, REFERENCE_MAX } from "@plant/core";
import {
  compareDecimals,
  currencySchema,
  nonNegativeDecimalSchema,
  positiveDecimalSchema,
} from "@plant/shared";
import { z } from "zod";

import type { MovementResult } from "@/lib/holdings/movements-input";
import {
  allRows,
  difference,
  type Ledger,
  writeOperation,
} from "@/lib/ledger/ledger";

import { holdingsOn, type ImportToWrite, type ImportWrite } from "./confirm";
import type { ImportOperationRow } from "./review";

// An operation as the review hands it over: a discarded one may hold
// anything typed; a kept one is complete.
const keptSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.enum(["purchase", "sale"]),
    quantity: positiveDecimalSchema,
    price: positiveDecimalSchema,
  }),
  z.object({
    kind: z.enum(["dividend", "coupon"]),
    amount: positiveDecimalSchema,
  }),
]);
const reviewedSchema = z.union([
  z.object({ id: z.string(), discarded: z.literal(true) }),
  z.intersection(
    z.object({
      id: z.string(),
      discarded: z.literal(false),
      date: z.iso.date(),
      symbol: z.string().min(1),
      currency: currencySchema,
      charges: nonNegativeDecimalSchema.nullable(),
      reference: z.string().trim().min(1).max(REFERENCE_MAX).nullable(),
    }),
    keptSchema,
  ),
]);

// Within a day, units come in before income is counted and before units go
// out, so a day's sale finds that day's purchase; across days the dates
// order them, oldest first.
const DAY_ORDER = { purchase: 0, dividend: 1, coupon: 1, sale: 2 } as const;

// The portfolio of the account's holding of an instrument with the latest
// movement on or before a day, open or closed; none when it never had one.
function lastHeldIn(
  state: Ledger,
  accountId: string,
  symbol: string,
  date: string,
): string | undefined {
  let latest: { date: string; portfolioId: string } | undefined;
  for (const row of allRows(state)) {
    if (
      row.account.id !== accountId ||
      row.holding.asset_class !== "instrument" ||
      row.holding.instrument_symbol !== symbol
    ) {
      continue;
    }
    for (const movement of state.movements.get(row.id) ?? []) {
      if (movement.date <= date && (!latest || movement.date > latest.date)) {
        latest = { date: movement.date, portfolioId: row.portfolio.id };
      }
    }
  }
  return latest?.portfolioId;
}

// Writes the reviewed operations of a document into its account, oldest
// first, all or nothing. A purchase goes to the portfolio holding the most of
// the instrument that day, else the account's default; a sale takes the
// largest holdings first; an income goes to the holding with the most units
// that day. A refusal names the row it stopped at.
export function writeImportOperations<S extends Ledger>(
  state: S,
  item: ImportToWrite,
  rows: readonly ImportOperationRow[],
  newId: () => string,
): ImportWrite<S> & { rowId?: string } {
  const refuse = (
    result: Extract<MovementResult, { ok: false }>,
    rowId?: string,
  ) => ({ state, result, operations: [], ...(rowId && { rowId }) });
  const account = state.accounts.find((each) => each.id === item.accountId);
  if (!account) return refuse({ ok: false, code: "not_found" });
  if (!z.array(reviewedSchema).safeParse(rows).success) {
    return refuse({ ok: false, code: "invalid" });
  }
  const kept = rows
    .map((row, position) => ({ row, position }))
    .filter(({ row }) => !row.discarded)
    .sort(
      (a, b) =>
        a.row.date!.localeCompare(b.row.date!) ||
        DAY_ORDER[a.row.kind!] - DAY_ORDER[b.row.kind!] ||
        a.position - b.position,
    )
    .map(({ row }) => row);
  if (kept.length === 0) return refuse({ ok: false, code: "invalid" });

  let next = state;
  const operations: string[] = [];
  for (const row of kept) {
    const kind = row.kind!;
    const date = row.date!;
    const instrument = next.instruments.find(
      (each) => each.symbol === row.symbol,
    );
    if (!instrument) return refuse({ ok: false, code: "not_found" }, row.id);
    const held = holdingsOn(next, account.id, date).filter(
      (each) => each.symbol === row.symbol,
    );
    const common = {
      source_connection_id: account.id,
      instrument_symbol: row.symbol,
      date,
      currency: row.currency,
      charges:
        row.charges !== null && compareDecimals(row.charges, "0") > 0
          ? [
              {
                kind: "other" as const,
                label: "Gastos del comprobante",
                amount: row.charges,
              },
            ]
          : [],
      reference: row.reference,
      note: `Carga de ${item.fileName}`.slice(0, 200),
    };
    let input;
    if (kind === "purchase" || kind === "sale") {
      const price = exactUnitPrice(instrument.type, row.price!);
      if (price === null) return refuse({ ok: false, code: "invalid" }, row.id);
      let parts: { portfolio_id: string; quantity: string }[];
      if (kind === "purchase") {
        parts = [
          {
            portfolio_id: held[0]?.row.portfolio.id ?? account.portfolio.id,
            quantity: row.quantity!,
          },
        ];
      } else {
        let left = row.quantity!;
        parts = [];
        for (const each of held) {
          if (compareDecimals(left, "0") <= 0) break;
          const taken =
            compareDecimals(each.quantity, left) < 0 ? each.quantity : left;
          parts.push({ portfolio_id: each.row.portfolio.id, quantity: taken });
          left = difference(left, taken);
        }
        if (compareDecimals(left, "0") > 0) {
          return refuse({ ok: false, code: "oversold" }, row.id);
        }
      }
      input = { kind, ...common, price, parts };
    } else {
      // Paid after the units left, it goes to the holding that had them
      // last.
      const portfolioId =
        held[0]?.row.portfolio.id ??
        lastHeldIn(next, account.id, row.symbol, date);
      if (!portfolioId) return refuse({ ok: false, code: "not_found" }, row.id);
      input = {
        kind,
        ...common,
        parts: [{ portfolio_id: portfolioId, amount: row.amount! }],
      };
    }
    const operationId = newId();
    const written = writeOperation(next, input, {
      operationId,
      newId,
      origin: { kind: "import", fileName: item.fileName, date },
    });
    if (!written.result.ok) return refuse(written.result, row.id);
    operations.push(operationId);
    next = written.state;
  }
  return { state: next, result: { ok: true, id: item.id }, operations };
}
