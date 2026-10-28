import { exactUnitPrice, REFERENCE_MAX } from "@plant/core";
import {
  compareDecimals,
  currencySchema,
  nonNegativeDecimalSchema,
  positiveDecimalSchema,
} from "@plant/shared";
import { z } from "zod";

import type { MovementResult } from "@/lib/holdings/movements-input";
import { allRows, type Ledger, writeOperation } from "@/lib/ledger/ledger";

import {
  arrivalPortfolio,
  holdingsOn,
  type ImportToWrite,
  type ImportWrite,
  takeUnits,
  transferInput,
} from "./confirm";
import { arrived } from "./operations-loaded";
import { reviewKindOf, takesUnitsOut } from "./operations-review";
import { IMPORT_OPERATION_KINDS, type ImportOperationRow } from "./review";

// An operation as the review hands it over: a discarded one may hold
// anything typed; a kept one is complete for its kind (REVIEW_KINDS).
const reviewedSchema = z.union([
  z.object({ id: z.string(), discarded: z.literal(true) }),
  z.object({
    id: z.string(),
    discarded: z.literal(false),
    date: z.iso.date(),
    kind: z.enum(IMPORT_OPERATION_KINDS),
    direction: z.enum(["in", "out"]).nullable().optional(),
    counterpartId: z.string().nullable().optional(),
    symbol: z.string().min(1),
    quantity: z.string().nullable(),
    price: z.string().nullable(),
    amount: z.string().nullable(),
    currency: currencySchema,
    charges: nonNegativeDecimalSchema.nullable(),
    reference: z.string().trim().min(1).max(REFERENCE_MAX).nullable(),
  }),
]);

const complete = (row: ImportOperationRow) =>
  row.discarded ||
  (reviewKindOf(row)?.needs.every((need) =>
    need === "counterpart"
      ? Boolean(row.counterpartId)
      : positiveDecimalSchema.safeParse(row[need]).success,
  ) ??
    false);

// Within a day, units come in before income is counted and before units go
// out, so a day's sale or withdrawal finds that day's deposit or purchase;
// across days the dates order them, oldest first.
const dayOrder = (row: ImportOperationRow) =>
  row.kind === "dividend" || row.kind === "coupon"
    ? 1
    : row.kind === "sale" || takesUnitsOut(row)
      ? 2
      : 0;

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

// As many operations as confirm_import takes in one call.
const CONFIRM_OPERATION_LIMIT = 500;

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
  if (
    !z.array(reviewedSchema).safeParse(rows).success ||
    !rows.every(complete)
  ) {
    return refuse({ ok: false, code: "invalid" });
  }
  const kept = rows
    .map((row, position) => ({ row, position }))
    .filter(({ row }) => !row.discarded)
    .sort(
      (a, b) =>
        a.row.date!.localeCompare(b.row.date!) ||
        dayOrder(a.row) - dayOrder(b.row) ||
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
    const held = holdingsOn(next, account.id, date)
      .filter((each) => each.symbol === row.symbol)
      .map((each) => ({
        portfolioId: each.row.portfolio.id,
        quantity: each.quantity,
      }));
    const operationIds: string[] = [];
    const write = (input: Parameters<typeof writeOperation>[1]) => {
      const operationId = newId();
      const written = writeOperation(next, input, {
        operationId,
        newId,
        origin: { kind: "import", fileName: item.fileName, date },
      });
      if (written.result.ok) {
        operationIds.push(operationId);
        next = written.state as S;
      }
      return written.result;
    };
    let result: MovementResult;
    if (kind === "transfer") {
      // Units sent to another of the user's accounts, from each portfolio
      // they leave, carrying their cost into the one that holds the most of
      // them there.
      const counterpart = next.accounts.find(
        (each) => each.id === row.counterpartId && each.id !== account.id,
      );
      if (!counterpart) {
        return refuse({ ok: false, code: "counterpart_not_found" }, row.id);
      }
      // Units the other account already shows coming in, by the transfer's
      // number or on its day, would arrive twice.
      if (arrived(next, counterpart.id, row)) {
        return refuse({ ok: false, code: "already_loaded" }, row.id);
      }
      const parts = takeUnits(held, row.quantity!);
      if (parts === null)
        return refuse({ ok: false, code: "oversold" }, row.id);
      const to = {
        accountId: counterpart.id,
        portfolioId: arrivalPortfolio(next, counterpart, row.symbol, date),
      };
      result = { ok: true, id: row.id };
      for (const [at, part] of parts.entries()) {
        result = write(
          transferInput({
            from: { accountId: account.id, portfolioId: part.portfolio_id },
            to,
            symbol: row.symbol,
            date,
            currency: row.currency,
            quantity: part.quantity,
            charges: at === 0 ? common.charges : [],
            reference: row.reference,
            note: common.note,
          }),
        );
        if (!result.ok) break;
      }
    } else if (kind === "adjustment" && takesUnitsOut(row)) {
      // Units that left the account go at the cost of the oldest.
      const parts = takeUnits(held, row.quantity!);
      if (parts === null)
        return refuse({ ok: false, code: "oversold" }, row.id);
      result = write({
        kind,
        direction: "out" as const,
        ...common,
        price: "0",
        parts,
      });
    } else if (kind === "adjustment" || kind === "purchase") {
      const price = exactUnitPrice(instrument.type, row.price!);
      if (price === null) return refuse({ ok: false, code: "invalid" }, row.id);
      const parts = [
        {
          portfolio_id: arrivalPortfolio(next, account, row.symbol, date),
          quantity: row.quantity!,
        },
      ];
      result = write(
        kind === "adjustment"
          ? { kind, direction: "in" as const, ...common, price, parts }
          : { kind, ...common, price, parts },
      );
    } else if (kind === "sale") {
      const price = exactUnitPrice(instrument.type, row.price!);
      if (price === null) return refuse({ ok: false, code: "invalid" }, row.id);
      const parts = takeUnits(held, row.quantity!);
      if (parts === null)
        return refuse({ ok: false, code: "oversold" }, row.id);
      result = write({ kind, ...common, price, parts });
    } else {
      // Paid after the units left, it goes to the holding that had them
      // last.
      const portfolioId =
        held[0]?.portfolioId ?? lastHeldIn(next, account.id, row.symbol, date);
      if (!portfolioId) return refuse({ ok: false, code: "not_found" }, row.id);
      result = write({
        kind,
        ...common,
        parts: [{ portfolio_id: portfolioId, amount: row.amount! }],
      });
    }
    if (!result.ok) return refuse(result, row.id);
    operations.push(...operationIds);
  }
  if (operations.length > CONFIRM_OPERATION_LIMIT) {
    return refuse({ ok: false, code: "too_many_operations" });
  }
  return { state: next, result: { ok: true, id: item.id }, operations };
}
