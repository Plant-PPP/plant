import { exactUnitPrice, REFERENCE_MAX } from "@plant/core";
import {
  compareDecimals,
  type Currency,
  exactOf,
  minus,
  stored,
  currencySchema,
  nonNegativeDecimalSchema,
  positiveDecimalSchema,
} from "@plant/shared";
import { z } from "zod";

import type { MovementResult } from "@/lib/holdings/movements-input";
import type { HeldCash } from "@/lib/imports/cash";
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
    kind: z.enum(IMPORT_OPERATION_KINDS).nullable(),
    direction: z.enum(["in", "out"]).nullable().optional(),
    counterpartId: z.string().nullable().optional(),
    debtPayment: z.boolean().optional(),
    payDebtId: z.string().nullable().optional(),
    symbol: z.string(),
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
    need === "symbol"
      ? row.symbol !== ""
      : need === "counterpart"
        ? Boolean(row.counterpartId)
        : need === "debt"
          ? Boolean(row.payDebtId)
          : positiveDecimalSchema.safeParse(row[need]).success,
  ) ??
    false);

// Within a day, units come in before income is counted and before units go
// out, so a day's sale, withdrawal or payment finds that day's deposit or
// purchase; across days the dates order them, oldest first.
const dayOrder = (row: ImportOperationRow) =>
  row.kind === "dividend" || row.kind === "coupon"
    ? 1
    : row.kind === "sale" || row.debtPayment || takesUnitsOut(row)
      ? 2
      : 0;

// A debt an import's payment may pay: one of the user's that is not a card,
// in its unit.
export type PayableDebt = {
  id: string;
  currency: Currency | null;
  uva: boolean;
  instrument_symbol: string | null;
};

// A payment confirm_import records on a debt, as record_liability_event
// takes it: paid from the account's cash, when it was, taking it.
export type DebtPayment = {
  liability_id: string;
  event: {
    kind: "payment";
    date: string;
    amount: string;
    annual_rate: null;
    settles: false;
  };
  cash: { holding_id: string; take: true; expected: string } | null;
};

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
  // The debts a payment may pay and the cash it may come from.
  payable: { debts: readonly PayableDebt[]; cash: readonly HeldCash[] } = {
    debts: [],
    cash: [],
  },
): ImportWrite<S> & { rowId?: string; payments: DebtPayment[] } {
  const refuse = (
    result: Extract<MovementResult, { ok: false }>,
    rowId?: string,
  ) => ({
    state,
    result,
    operations: [],
    payments: [],
    ...(rowId && { rowId }),
  });
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
  const payments: DebtPayment[] = [];
  const cashLeft = new Map<string, string>();
  for (const reviewed of kept) {
    let row = reviewed;
    if (reviewed.debtPayment) {
      const debt = payable.debts.find((each) => each.id === reviewed.payDebtId);
      if (!debt) {
        return refuse({ ok: false, code: "debt_not_found" }, reviewed.id);
      }
      const fromAccount = reviewed.kind === "adjustment";
      let cash: DebtPayment["cash"] = null;
      // A debt in a currency paid from the account takes its one cash
      // holding in that currency.
      if (fromAccount && debt.instrument_symbol === null) {
        if (debt.currency === null || debt.uva) {
          return refuse({ ok: false, code: "no_cash_link" }, reviewed.id);
        }
        const held = payable.cash.filter(
          (each) =>
            each.accountId === account.id && each.currency === debt.currency,
        );
        if (held.length !== 1) {
          return refuse({ ok: false, code: "no_cash" }, reviewed.id);
        }
        // What the holding has once the import's earlier payments took
        // theirs, as the database checks each one against.
        const { id } = held[0]!;
        const left = cashLeft.get(id) ?? held[0]!.amount;
        if (compareDecimals(left, reviewed.quantity!) < 0) {
          return refuse({ ok: false, code: "insufficient_cash" }, reviewed.id);
        }
        cash = { holding_id: id, take: true, expected: left };
        cashLeft.set(
          id,
          stored(minus(exactOf(left), exactOf(reviewed.quantity!))),
        );
      }
      payments.push({
        liability_id: debt.id,
        event: {
          kind: "payment",
          date: reviewed.date!,
          amount: reviewed.quantity!,
          annual_rate: null,
          settles: false,
        },
        cash,
      });
      if (!fromAccount || debt.instrument_symbol === null) continue;
      // A crypto loan paid from the account: its units left it.
      row = {
        ...reviewed,
        symbol: debt.instrument_symbol,
        debtPayment: false,
      };
    }
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
      // Units the other account already showed coming in, by the
      // transfer's number or on its day, would arrive twice. Read before this
      // import, so its own transfers are not taken for them.
      if (arrived(state, counterpart.id, row)) {
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
  if (operations.length + payments.length > CONFIRM_OPERATION_LIMIT) {
    return refuse({ ok: false, code: "too_many_operations" });
  }
  return {
    state: next,
    result: { ok: true, id: item.id },
    operations,
    payments,
  };
}
