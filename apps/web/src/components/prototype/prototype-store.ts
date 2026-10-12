import {
  admitManualPrice,
  type CashFlow,
  type Liability,
  withManualPrices,
  cashFlowsOf,
  type QuoteSnapshot,
  admitMovement,
  admitMovements,
  type ManualPrice,
  manualPriceSchema,
  isIncome,
  isOrderRefusal,
  isYield,
  type MovementDraft,
  type SaleResult,
  splitCharges,
  startsHolding,
  takesUnits,
  compareKeys,
  compareMovements,
  type Denominator,
  EMPTY_POSITION,
  type Holding,
  holdingSchema,
  type LedgerStep,
  type Movement,
  type MovementCursor,
  movementKey,
  type Position,
  type PositionMoney,
  positionOf,
  quantityOn,
  replayHoldings,
  type ReferenceDollar,
  lift,
  referenceUnit,
  type StoredQuotes,
  snapshotOn,
  UNIT_FX_KINDS,
} from "@plant/core";
import {
  compareExact,
  type Currency,
  exactOf,
  minus,
  negated,
  over,
  stored,
  sumOrNull,
  ZERO,
} from "@plant/shared";

import { rowOf } from "@/components/holdings/holding-fields";
import { type AssetsFilter, matchesFilter } from "@/lib/holdings/assets-filter";
import type {
  MovementLine,
  OperationParts,
  MovementResult,
  MovementScope,
  MovementsPage,
  QuoteQuery,
  SaleLine,
  SalesSlice,
  TransferCostQuery,
} from "@/lib/holdings/movements-input";
import type {
  HoldingRow,
  HoldingsView,
  InstrumentRow,
} from "@/lib/holdings/read";
import {
  holdingInsertSchema,
  holdingUpdateSchema,
  operationInputSchema,
} from "@/lib/holdings/schemas";
import { MOVEMENTS_PAGE } from "@/lib/portfolio-setup/limits";
import type {
  PortfolioRow,
  SourceConnectionRow,
} from "@/lib/portfolio-setup/read";
import type { InstrumentHolding } from "@/lib/holdings/instrument-history";
import type { Conversation } from "@/lib/assistant/chat";
import type { ImportItem } from "@/lib/imports/review";
import type { PriceResult } from "@/lib/holdings/price-input";
import { holdingsValuation } from "@/lib/holdings/valuation-view";
import type { WriteResult } from "@/lib/portfolio-setup/write-result";
import type { HoldingDeleteResult } from "@/lib/holdings/delete-result";
import type { Fixtures } from "@/lib/prototype/fixtures";

// The prototype's data, held in memory: the fixtures as the user changes them.
// A holding keeps the ids of its account and portfolio, so a rename shows on
// every row; an instrument holding sold to zero is closed, out of the lists,
// with its sales kept.
export type PrototypeState = {
  today: string;
  referenceDollar: ReferenceDollar;
  instruments: InstrumentRow[];
  accounts: SourceConnectionRow[];
  portfolios: PortfolioRow[];
  archivedAccounts: SourceConnectionRow[];
  archivedPortfolios: PortfolioRow[];
  // Newest first, as the real page lists them.
  holdings: StoredHolding[];
  // Each holding's movements, oldest first; a new array on every change.
  movements: ReadonlyMap<string, readonly Movement[]>;
  // The entry order the next operation takes, above every movement's.
  nextEntryOrder: number;
  revisions: ReadonlyMap<string, number>;
  quotes: StoredQuotes;
  manualPrices: readonly ManualPrice[];
  // The closed months a write changed, by period, with the day it did.
  recalculated: ReadonlyMap<string, string>;
  // Newest first.
  liabilities: Liability[];
  // Newest first.
  imports: ImportItem[];
  // The day of each upload, deleted accounts' included: the monthly limit
  // counts them all.
  uploadedOn: string[];
  // Newest first.
  conversations: Conversation[];
  // The day of each question asked, deleted conversations' included.
  askedOn: string[];
};

export type StoredHolding = {
  holding: Holding;
  accountId: string;
  portfolioId: string;
  closed: boolean;
};

export function initialState(
  fixtures: Fixtures,
  today: string,
): PrototypeState {
  const movements = new Map<string, Movement[]>();
  for (const movement of fixtures.movements) {
    const own = movements.get(movement.holding_id) ?? [];
    own.push(movement);
    movements.set(movement.holding_id, own);
  }
  for (const own of movements.values()) own.sort(compareMovements);
  return {
    today,
    referenceDollar: fixtures.referenceDollar,
    instruments: fixtures.instruments,
    accounts: fixtures.accounts,
    portfolios: fixtures.portfolios,
    archivedAccounts: [],
    archivedPortfolios: [],
    holdings: fixtures.holdings.map((row) => ({
      holding: row.holding,
      accountId: row.account.id,
      portfolioId: row.portfolio.id,
      closed: fixtures.closed.includes(row.id),
    })),
    movements,
    nextEntryOrder:
      Math.max(-1, ...fixtures.movements.map((each) => each.entry_order)) + 1,
    revisions: new Map([...movements.keys()].map((id) => [id, 0])),
    quotes: fixtures.quotes,
    manualPrices: fixtures.manualPrices,
    recalculated: new Map(),
    liabilities: fixtures.liabilities,
    imports: [],
    uploadedOn: [],
    conversations: [],
    askedOn: [],
  };
}

// --- Reads -----------------------------------------------------------------

// A portfolio, archived or not.
const portfolioOf = (state: PrototypeState, id: string) =>
  [...state.portfolios, ...state.archivedPortfolios].find(
    (each) => each.id === id,
  );

function rowOfStored(
  state: PrototypeState,
  stored: StoredHolding,
): HoldingRow | null {
  // A holding sold to zero may sit in an account or portfolio archived since.
  const account = [...state.accounts, ...state.archivedAccounts].find(
    ({ id }) => id === stored.accountId,
  );
  const portfolio = portfolioOf(state, stored.portfolioId);
  if (!account || !portfolio) return null;
  return {
    id: stored.holding.id,
    holding: stored.holding,
    account: { id: account.id, institution: account.institution },
    portfolio: { id: portfolio.id, name: portfolio.name },
    instrumentType:
      stored.holding.asset_class === "instrument"
        ? (state.instruments.find(
            ({ symbol }) => symbol === stored.holding.instrument_symbol,
          )?.type ?? null)
        : null,
  };
}

// Every holding as the lists show it, closed ones included.
export function allRows(state: PrototypeState): HoldingRow[] {
  return state.holdings.flatMap((stored) => rowOfStored(state, stored) ?? []);
}

// The open holdings, as the real page's read returns them.
export function holdingsView(state: PrototypeState): HoldingsView {
  const closed = new Set(
    state.holdings.filter((each) => each.closed).map((each) => each.holding.id),
  );
  return {
    active: allRows(state).filter((row) => !closed.has(row.id)),
    activeTruncated: false,
    archived: [],
    archivedPage: null,
    archivedFirstHref: null,
    archivedNextHref: null,
  };
}

// The holdings whose movements replay together: one account's holdings of an
// instrument, which transfers move units between. Any other holding is a
// group of its own.
export const groupKey = (stored: StoredHolding): string =>
  stored.holding.asset_class === "instrument"
    ? JSON.stringify([stored.accountId, stored.holding.instrument_symbol])
    : JSON.stringify([stored.holding.id]);

const groupIndex = new WeakMap<
  readonly StoredHolding[],
  Map<string, readonly string[]>
>();

// The ids of the holdings in a holding's group, itself included.
export function groupOf(
  state: PrototypeState,
  holdingId: string,
): readonly string[] {
  let byHolding = groupIndex.get(state.holdings);
  if (!byHolding) {
    const members = new Map<string, string[]>();
    for (const each of state.holdings) {
      const key = groupKey(each);
      members.set(key, [...(members.get(key) ?? []), each.holding.id]);
    }
    byHolding = new Map();
    for (const ids of members.values()) {
      for (const id of ids) byHolding.set(id, ids);
    }
    groupIndex.set(state.holdings, byHolding);
  }
  return byHolding.get(holdingId) ?? [holdingId];
}

// A group's steps, by holding, unit and reference dollar, kept while each of
// its holdings' movements stays the same array.
type GroupSteps = {
  members: readonly (readonly Movement[])[];
  byKey: Map<string, Map<string, LedgerStep[]>>;
};
const stepCache = new WeakMap<readonly Movement[], GroupSteps>();
const NO_STEPS: readonly LedgerStep[] = [];

// The movements of each holding in a holding's group that has any.
const groupMovements = (
  state: PrototypeState,
  holdingId: string,
): readonly (readonly Movement[])[] =>
  groupOf(state, holdingId).flatMap((id) => {
    const own = state.movements.get(id);
    return own && own.length > 0 ? [own] : [];
  });

export function stepsOf(
  state: PrototypeState,
  holdingId: string,
  unit: Denominator,
): readonly LedgerStep[] {
  const members = groupMovements(state, holdingId);
  const first = members[0];
  if (!first) return NO_STEPS;
  let group = stepCache.get(first);
  if (
    !group ||
    group.members.length !== members.length ||
    group.members.some((each, index) => each !== members[index])
  ) {
    group = { members, byKey: new Map() };
    stepCache.set(first, group);
  }
  const key = `${unit}:${state.referenceDollar}`;
  let steps = group.byKey.get(key);
  if (!steps) {
    steps = replayHoldings(members.flat(), unit, state.referenceDollar);
    group.byKey.set(key, steps);
  }
  return steps.get(holdingId) ?? NO_STEPS;
}

// The revisions with every holding in a holding's group moved on, so the
// tables of the holdings a write reaches load again.
function bumpGroup(
  state: PrototypeState,
  holdingId: string,
): Map<string, number> {
  const revisions = new Map(state.revisions);
  for (const id of groupOf(state, holdingId)) {
    revisions.set(id, (revisions.get(id) ?? 0) + 1);
  }
  return revisions;
}

export function positionsOf(
  state: PrototypeState,
  unit: Denominator,
): Map<string, Position> {
  const positions = new Map<string, Position>();
  for (const [holdingId, movements] of state.movements) {
    if (movements.length === 0) continue;
    positions.set(holdingId, positionOf(stepsOf(state, holdingId, unit)));
  }
  return positions;
}

// The operation id a new transfer's suggestion writes under, in a state it
// throws away.
const SUGGESTED = "ffffffff-ffff-4fff-bfff-ffffffffffff";

// The cost per unit a transfer's units carry when it is written with their
// cost left to them, in its currency: the write itself, run and thrown away,
// so the suggestion is what saving it carries. None when it cannot be written
// or its cost has no value in that currency.
export function suggestedTransferCost(
  state: PrototypeState,
  { input, operationId }: TransferCostQuery,
): string | null {
  // Every part's price is nulled before parsing, so a cost the user mistyped
  // still gets the cost the units carry.
  const parsed = operationInputSchema.safeParse(
    typeof input === "object" &&
      input !== null &&
      "parts" in input &&
      Array.isArray(input.parts)
      ? {
          ...input,
          parts: input.parts.map((part: unknown) =>
            typeof part === "object" && part !== null && "price" in part
              ? { ...part, price: null }
              : part,
          ),
        }
      : input,
  );
  if (!parsed.success || parsed.data.kind !== "transfer") return null;
  const operation = parsed.data;
  const id = operationId ?? SUGGESTED;
  let ids = 0;
  const { state: written, result } = writeOperation(state, operation, {
    operationId: id,
    replacing: operationId !== null,
    newId: () => `${id}-${(ids += 1)}`,
  });
  if (!result.ok) return null;
  const leaving = operation.parts.find((part) => part.direction === "out")!;
  const holding = holdingIn(
    written,
    operation.source_connection_id,
    operation.instrument_symbol,
    leaving.portfolio_id,
  )!.holding.id;
  const own = written.movements.get(holding)!;
  const index = own.findIndex((each) => each.operation_id === id);
  // The unit an amount in the transfer's currency is held in.
  const unit = lift(
    { amount: { n: 0n, d: 1n }, currency: operation.currency },
    referenceUnit(state.referenceDollar),
    state.referenceDollar,
  ).denominator;
  // Replayed apart from stepsOf: its cache is keyed on a movements array the
  // state thrown away can share with the real one, whose entry it would
  // replace.
  const steps = replayHoldings(
    groupMovements(written, holding).flat(),
    unit,
    state.referenceDollar,
  ).get(holding)!;
  const amount = amountOf(
    own[index]!,
    steps[index - 1]!.position,
    steps[index]!,
  );
  return amount === null
    ? null
    : stored(over(exactOf(amount), exactOf(leaving.quantity)));
}

// The years with any sale, newest first.
export function yearsOf(state: PrototypeState): string[] {
  const years = new Set<string>();
  for (const movements of state.movements.values()) {
    for (const movement of movements) {
      if (movement.kind === "sale") years.add(movement.date.slice(0, 4));
    }
  }
  return [...years].sort().reverse();
}

// The sales of a year whose holding, open or closed, matches the filters,
// newest first: the first `limit` rows and the totals of all of them.
export function salesOf(
  state: PrototypeState,
  {
    year,
    unit,
    filter,
    names,
    limit,
  }: {
    year: string | null;
    unit: Denominator;
    filter: AssetsFilter;
    names: ReadonlyMap<string, string>;
    limit: number;
  },
): SalesSlice {
  // Each sale operation's parts the filters keep, by operation.
  const operations = new Map<
    string,
    { movements: Movement[]; sales: (SaleResult | null)[]; row: HoldingRow }
  >();
  if (year !== null) {
    for (const row of allRows(state)) {
      if (!matchesFilter(row, filter, names)) continue;
      const movements = state.movements.get(row.id) ?? [];
      const steps = stepsOf(state, row.id, unit);
      movements.forEach((movement, index) => {
        if (movement.kind !== "sale" || !movement.date.startsWith(year)) return;
        const operation = operations.get(movement.operation_id) ?? {
          movements: [],
          sales: [],
          row,
        };
        operation.movements.push(movement);
        operation.sales.push(steps[index]?.sale ?? null);
        operations.set(movement.operation_id, operation);
      });
    }
  }
  const lines: SaleLine[] = [...operations].map(
    ([operationId, { movements, sales, row }]) => ({
      operationId,
      movements,
      row,
      sale: sales.includes(null)
        ? null
        : {
            gross: sumOrNull(sales.map((each) => each!.gross))!,
            charges: sumOrNull(sales.map((each) => each!.charges))!,
            cost: sumOrNull(sales.map((each) => each!.cost))!,
            result: sumOrNull(sales.map((each) => each!.result))!,
          },
    }),
  );
  lines.sort((a, b) => compareMovements(b.movements[0]!, a.movements[0]!));
  return {
    rows: lines.slice(0, limit),
    truncated: lines.length > limit,
    totals: {
      count: lines.length,
      gross: sumOrNull(lines.map((line) => line.sale?.gross ?? null)),
      charges: sumOrNull(lines.map((line) => line.sale?.charges ?? null)),
      result: sumOrNull(lines.map((line) => line.sale?.result ?? null)),
    },
  };
}

// a − b, to the decimals the store keeps.
export const difference = (a: string, b: string): string =>
  stored(minus(exactOf(a), exactOf(b)));

// Null when either side has no money in the unit.
export function moneyChange(
  before: Position,
  step: LedgerStep,
  field: keyof PositionMoney,
): string | null {
  const was = before.money;
  const now = step.position.money;
  return was && now ? difference(now[field], was[field]) : null;
}

export function lineOf(
  movement: Movement,
  before: Position,
  step: LedgerStep,
  operation: OperationParts,
): MovementLine {
  return {
    movement,
    amount: amountOf(movement, before, step),
    charges: moneyChange(before, step, "charges"),
    operation,
  };
}

// A movement's amount from its step and the position before it: the cost its
// units added or took out, a sale's gross, what an income paid, or what a
// yield earned (negative when it lost).
function amountOf(
  movement: Movement,
  before: Position,
  step: LedgerStep,
): string | null {
  const cost = moneyChange(before, step, "cost");
  if (cost === null) return null;
  if (isIncome(movement.kind) || isYield(movement)) {
    return moneyChange(before, step, "income");
  }
  if (movement.kind === "sale") return step.sale?.gross ?? null;
  return takesUnits(movement) ? stored(negated(exactOf(cost))) : cost;
}

// Every part of an operation, from the holdings it touched.
export function operationOf(
  state: PrototypeState,
  operationId: string,
): OperationParts | null {
  const parts: OperationParts["parts"] = [];
  let placed: StoredHolding | undefined;
  for (const stored of state.holdings) {
    for (const movement of state.movements.get(stored.holding.id) ?? []) {
      if (movement.operation_id !== operationId) continue;
      placed ??= stored;
      parts.push({
        movement,
        portfolioId: stored.portfolioId,
        portfolioName: portfolioOf(state, stored.portfolioId)?.name ?? "",
      });
    }
  }
  if (!placed || placed.holding.asset_class !== "instrument") return null;
  return {
    accountId: placed.accountId,
    instrument: placed.holding.instrument_symbol,
    parts,
  };
}

function inScope(row: HoldingRow, scope: MovementScope): boolean {
  if ("holdingId" in scope) return row.id === scope.holdingId;
  if ("accountId" in scope) return row.account.id === scope.accountId;
  if ("symbol" in scope) {
    return (
      row.holding.asset_class === "instrument" &&
      row.holding.instrument_symbol === scope.symbol
    );
  }
  return row.portfolio.id === scope.portfolioId;
}

// An instrument's holdings, open and closed, each with its position and value
// in `unit`, and the cash flows of all of them; null flows when one could not
// be expressed in the unit.
export function instrumentHoldings(
  state: PrototypeState,
  symbol: string,
  unit: Denominator,
  snapshot: QuoteSnapshot,
): { holdings: InstrumentHolding[]; flows: CashFlow[] | null } {
  const closed = new Set(
    state.holdings.filter((each) => each.closed).map((each) => each.holding.id),
  );
  const rows = allRows(state).filter((row) => inScope(row, { symbol }));
  const { values } = holdingsValuation({
    holdings: rows.filter((row) => !closed.has(row.id)),
    truncated: false,
    snapshot,
    unit,
    referenceDollar: state.referenceDollar,
  });
  const flows: CashFlow[] = [];
  let known = true;
  const holdings = rows.map((row) => {
    const steps = stepsOf(state, row.id, unit);
    const own = cashFlowsOf(state.movements.get(row.id) ?? [], steps);
    if (own) flows.push(...own);
    else known = false;
    return {
      row,
      closed: closed.has(row.id),
      position: positionOf(steps),
      value: values[row.id]?.value ?? null,
    };
  });
  return { holdings, flows: known ? flows : null };
}

// One page of a scope's movements, newest first, after `cursor`: each
// holding's list is read from where the cursor falls in it, and the lists
// merged.
export function movementsPage(
  state: PrototypeState,
  scope: MovementScope,
  unit: Denominator,
  cursor: MovementCursor | null,
  limit = MOVEMENTS_PAGE,
): MovementsPage {
  const lists = allRows(state)
    .filter((row) => inScope(row, scope))
    .map((row) => {
      const movements = state.movements.get(row.id) ?? [];
      // The first index whose movement comes at or after the cursor; the
      // page reads backwards from just before it.
      let low = 0;
      let high = movements.length;
      if (cursor) {
        while (low < high) {
          const middle = (low + high) >> 1;
          if (compareKeys(movementKey(movements[middle]!), cursor) < 0) {
            low = middle + 1;
          } else high = middle;
        }
      } else low = movements.length;
      return {
        movements,
        steps: stepsOf(state, row.id, unit),
        next: low - 1,
      };
    });
  const rows: MovementLine[] = [];
  while (rows.length < limit) {
    let best: (typeof lists)[number] | undefined;
    for (const list of lists) {
      if (list.next < 0) continue;
      if (
        !best ||
        compareMovements(
          list.movements[list.next]!,
          best.movements[best.next]!,
        ) > 0
      ) {
        best = list;
      }
    }
    if (!best) break;
    const index = best.next;
    rows.push(
      lineOf(
        best.movements[index]!,
        index === 0 ? EMPTY_POSITION : best.steps[index - 1]!.position,
        best.steps[index]!,
        operationOf(state, best.movements[index]!.operation_id)!,
      ),
    );
    best.next -= 1;
  }
  const more = lists.some((list) => list.next >= 0);
  const last = rows.at(-1);
  return {
    ok: true,
    rows,
    next: more && last ? movementKey(last.movement) : null,
  };
}

// --- Writes ----------------------------------------------------------------

export type Write<R> = { state: PrototypeState; result: R };

const refused = <R>(state: PrototypeState, result: R): Write<R> => ({
  state,
  result,
});

// A refused write of the setup lists, which leaves the state as it was.
export const refusedWrite = (
  state: PrototypeState,
  code: Extract<WriteResult, { ok: false }>["code"],
): Write<WriteResult> => refused(state, { ok: false, code });

// An instrument's price on a date in its own currency, from the feeds or else
// the user's manual price; none when neither has one. prototype-closes'
// snapshotAt values a day on its own, in any unit and from trades when nothing
// quotes it; the two become one if a suggestion ever takes that fallback.
export function priceOn(
  state: PrototypeState,
  { symbol, currency, date }: QuoteQuery,
): string | null {
  const quote = withManualPrices(
    snapshotOn(state.quotes, date, { fxKinds: [], symbols: [symbol] }).snapshot,
    state.manualPrices,
  ).snapshot.prices[symbol];
  return quote && quote.currency === currency ? quote.price : null;
}

export const priceToday = (
  state: PrototypeState,
  instrument: { symbol: string; currency: Currency },
): string | null => priceOn(state, { ...instrument, date: state.today });

export function createHolding(
  state: PrototypeState,
  input: unknown,
  id: string,
): Write<WriteResult> {
  const parsed = holdingInsertSchema.safeParse(input);
  if (!parsed.success) return refused(state, { ok: false, code: "invalid" });
  const { source_connection_id, portfolio_id, ...columns } = parsed.data;
  const account = state.accounts.find(({ id }) => id === source_connection_id);
  const portfolio = state.portfolios.find(({ id }) => id === portfolio_id);
  if (!account || !portfolio) {
    return refused(state, { ok: false, code: "not_found" });
  }
  const { holding } = rowOf(id, columns, {
    account: { id: account.id, institution: account.institution },
    portfolio,
    instrumentType: null,
  });
  if (holding.asset_class !== "instrument") {
    return {
      state: {
        ...state,
        holdings: [
          {
            holding,
            accountId: account.id,
            portfolioId: portfolio.id,
            closed: false,
          },
          ...state.holdings,
        ],
      },
      result: { ok: true, id },
    };
  }
  const instrument = state.instruments.find(
    ({ symbol }) => symbol === holding.instrument_symbol,
  );
  if (!instrument) return refused(state, { ok: false, code: "not_found" });
  // One holding per instrument in an account's portfolio, as the database's
  // unique key keeps it: an open one refuses a second, and one sold to zero
  // takes the units back as an adjustment.
  const existing = holdingIn(
    state,
    account.id,
    instrument.symbol,
    portfolio.id,
  );
  if (existing && !existing.closed) {
    return refused(state, { ok: false, code: "duplicate" });
  }
  // Its quantity is what its movements leave, so the units come in at
  // today's price. Without one their cost would be made up, so the page asks
  // for an opening balance with its price instead.
  const price = priceToday(state, instrument);
  if (price === null) return refused(state, { ok: false, code: "invalid" });
  const opening = {
    source_connection_id: account.id,
    instrument_symbol: instrument.symbol,
    date: state.today,
    currency: instrument.currency,
    price,
    parts: [{ portfolio_id: portfolio.id, quantity: holding.amount }],
  };
  const base: PrototypeState = existing
    ? state
    : {
        ...state,
        holdings: [
          {
            holding,
            accountId: account.id,
            portfolioId: portfolio.id,
            closed: false,
          },
          ...state.holdings,
        ],
      };
  const opened = writeOperation(
    base,
    existing
      ? { ...opening, kind: "adjustment", direction: "in" }
      : { ...opening, kind: "opening_balance" },
    { operationId: `${id}-opening`, newId: () => `${id}-opening` },
  );
  return opened.result.ok
    ? {
        state: opened.state,
        result: { ok: true, id: existing?.holding.id ?? id },
      }
    : refused(state, { ok: false, code: "invalid" });
}

export function updateHolding(
  state: PrototypeState,
  id: string,
  input: unknown,
): Write<WriteResult> {
  const parsed = holdingUpdateSchema.safeParse(input);
  const stored = state.holdings.find((each) => each.holding.id === id);
  if (!parsed.success) return refused(state, { ok: false, code: "invalid" });
  if (!stored || stored.closed) {
    return refused(state, { ok: false, code: "not_found" });
  }
  // The class filters the row, as the real update does.
  if (parsed.data.asset_class !== stored.holding.asset_class) {
    return refused(state, { ok: false, code: "not_found" });
  }
  const { portfolio_id = stored.portfolioId, ...columns } = parsed.data;
  if (!state.portfolios.some((each) => each.id === portfolio_id)) {
    return refused(state, { ok: false, code: "not_found" });
  }
  // The database's unique key: one holding of an instrument per account and
  // portfolio, a closed one included.
  if (
    stored.holding.asset_class === "instrument" &&
    portfolio_id !== stored.portfolioId &&
    holdingIn(
      state,
      stored.accountId,
      stored.holding.instrument_symbol,
      portfolio_id,
    )
  ) {
    return refused(state, { ok: false, code: "duplicate" });
  }
  // A holding with movements keeps the quantity they leave.
  const hasMovements = (state.movements.get(id)?.length ?? 0) > 0;
  const holding = holdingSchema.parse({
    ...stored.holding,
    ...columns,
    ...(hasMovements && { amount: stored.holding.amount }),
    portfolio_id,
  });
  const holdings = state.holdings.map((each) =>
    each === stored ? { ...each, holding, portfolioId: portfolio_id } : each,
  );
  return {
    state: {
      ...state,
      holdings,
      // The holdings it shares operations with list its new portfolio.
      ...(portfolio_id !== stored.portfolioId && {
        revisions: bumpGroup(state, id),
      }),
    },
    result: { ok: true, id },
  };
}

// The quantity its movements leave becomes the holding's amount; at zero the
// holding closes.
function withMovements(
  state: PrototypeState,
  holdingId: string,
  movements: Movement[],
  quantity: string,
): PrototypeState {
  const closed = exactOf(quantity).n === 0n;
  return {
    ...state,
    movements: new Map(state.movements).set(holdingId, movements),
    revisions: bumpGroup(state, holdingId),
    holdings: state.holdings.map((each) =>
      each.holding.id !== holdingId
        ? each
        : {
            ...each,
            closed,
            holding: closed
              ? each.holding
              : holdingSchema.parse({ ...each.holding, amount: quantity }),
          },
    ),
  };
}

// The refusal for an account or portfolio the user archived, the account's
// first; null when neither is archived.
function archivedCode(
  state: PrototypeState,
  { accountId, portfolioId }: { accountId?: string; portfolioId?: string },
): "source_connection_archived" | "portfolio_archived" | null {
  if (state.archivedAccounts.some(({ id }) => id === accountId)) {
    return "source_connection_archived";
  }
  return state.archivedPortfolios.some(({ id }) => id === portfolioId)
    ? "portfolio_archived"
    : null;
}

// The archived account or portfolio a holding sits in, if any: no holding may
// stay open there.
function archivedHome(state: PrototypeState, holdingId: string) {
  const stored = state.holdings.find((each) => each.holding.id === holdingId);
  return stored ? archivedCode(state, stored) : null;
}

// The open or closed holding of an instrument in an account and portfolio.
export const holdingIn = (
  state: PrototypeState,
  accountId: string,
  symbol: string,
  portfolioId: string,
): StoredHolding | undefined =>
  state.holdings.find(
    (each) =>
      each.accountId === accountId &&
      each.portfolioId === portfolioId &&
      each.holding.asset_class === "instrument" &&
      each.holding.instrument_symbol === symbol,
  );

// Records an operation (`replacing` none) or an edit of one: each part becomes
// a movement of its portfolio's holding, which a part that can start one
// creates when missing; the charges split across the parts by quantity (or
// amount). Every touched holding is admitted again, or nothing changes.
export function writeOperation(
  state: PrototypeState,
  input: unknown,
  {
    operationId,
    replacing = false,
    newId,
  }: { operationId: string; replacing?: boolean; newId: () => string },
): Write<MovementResult> {
  const parsed = operationInputSchema.safeParse(input);
  if (!parsed.success) return refused(state, { ok: false, code: "invalid" });
  const operation = parsed.data;
  const {
    parts: given,
    source_connection_id: accountId,
    instrument_symbol: instrumentSymbol,
    ...fields
  } = operation;
  const account = state.accounts.find(({ id }) => id === accountId);
  const instrument = state.instruments.find(
    ({ symbol }) => symbol === instrumentSymbol,
  );
  if (!account || !instrument) {
    return refused(state, {
      ok: false,
      code: archivedCode(state, { accountId }) ?? "not_found",
    });
  }
  const was = operationOf(state, operationId);
  if (replacing && !was)
    return refused(state, { ok: false, code: "not_found" });
  if (!replacing && was) return refused(state, { ok: false, code: "invalid" });
  // An edit keeps the operation's account and instrument, as its dialog does.
  if (
    was &&
    (was.accountId !== account.id || was.instrument !== instrument.symbol)
  ) {
    return refused(state, { ok: false, code: "invalid" });
  }
  const rates = snapshotOn(state.quotes, operation.date, {
    fxKinds: UNIT_FX_KINDS,
    symbols: [],
  }).snapshot.fx;
  // An edit first takes the operation's movements out of their holdings.
  const without = new Map<string, Movement[]>();
  for (const [holdingId, own] of state.movements) {
    if (own.some((each) => each.operation_id === operationId)) {
      without.set(
        holdingId,
        own.filter((each) => each.operation_id !== operationId),
      );
    }
  }
  // Each part with its portfolio. A yield given as a balance is the
  // difference from what its holding held at the end of that day.
  const parts: {
    portfolio: PortfolioRow;
    part: Exclude<(typeof given)[number], { balance: string }>;
  }[] = [];
  for (const part of given) {
    const portfolioId = part.portfolio_id;
    const portfolio = state.portfolios.find(({ id }) => id === portfolioId);
    if (!portfolio) {
      return refused(state, {
        ok: false,
        code: archivedCode(state, { portfolioId }) ?? "not_found",
      });
    }
    if (!("balance" in part)) {
      parts.push({ portfolio, part });
      continue;
    }
    const home = holdingIn(
      state,
      accountId,
      instrumentSymbol,
      part.portfolio_id,
    )?.holding.id;
    const own =
      home === undefined
        ? []
        : (without.get(home) ?? state.movements.get(home) ?? []);
    const change = minus(
      exactOf(part.balance),
      exactOf(quantityOn(own, operation.date)),
    );
    const sign = compareExact(change, ZERO);
    if (sign === 0) return refused(state, { ok: false, code: "same_balance" });
    parts.push({
      portfolio,
      part: {
        portfolio_id: portfolioId,
        direction: sign > 0 ? "in" : "out",
        quantity: stored(sign > 0 ? change : negated(change)),
      },
    });
  }
  const sizes = parts.map(({ part }) =>
    "quantity" in part ? part.quantity : part.amount,
  );
  const charges = splitCharges(
    "charges" in operation ? operation.charges : [],
    sizes,
  );
  const writeAt = (entryOrder: number): Write<MovementResult> => {
    let next = state;
    const touched = new Map(without);
    for (const [index, { portfolio, part }] of parts.entries()) {
      const { portfolio_id: portfolioId, ...ownFields } = part;
      const stored = holdingIn(
        next,
        account.id,
        instrument.symbol,
        portfolioId,
      );
      const holdingId = stored?.holding.id ?? newId();
      const draft = {
        ...fields,
        ...ownFields,
        charges: charges[index]!,
        id: newId(),
        holding_id: holdingId,
        operation_id: operationId,
        entry_order: entryOrder,
        rates,
      } as MovementDraft;
      if (!stored) {
        if (!startsHolding(draft as Movement)) {
          return refused(state, { ok: false, code: "not_found" });
        }
        next = createdHolding(next, account, instrument, portfolio, {
          id: holdingId,
          quantity: sizes[index]!,
        });
      }
      const own = touched.get(holdingId) ?? [
        ...(next.movements.get(holdingId) ?? []),
      ];
      const admitted = admitMovement({ prior: null, after: own }, draft, {
        today: state.today,
      });
      if (!admitted.ok) {
        return refused(state, { ok: false, code: admitted.code });
      }
      touched.set(holdingId, [...own, draft as Movement]);
    }
    for (const [holdingId, own] of touched) {
      // A holding an edit left with no movement goes, as a delete would leave it.
      if (own.length === 0) {
        next = removeHolding(next, holdingId);
        continue;
      }
      const admitted = admitMovements({ prior: null, after: own });
      if (!admitted.ok) {
        return refused(state, { ok: false, code: admitted.code });
      }
      const archived = archivedHome(next, holdingId);
      if (exactOf(admitted.quantity).n > 0n && archived) {
        return refused(state, { ok: false, code: archived });
      }
      next = withMovements(
        next,
        holdingId,
        [...own].sort(compareMovements),
        admitted.quantity,
      );
    }
    return {
      state: {
        ...next,
        nextEntryOrder: Math.max(state.nextEntryOrder, entryOrder + 1),
      },
      result: { ok: true, id: operationId },
    };
  };
  // A new operation is entered last. An edit keeps its operation's place on
  // its date. One that moves the date, or stops being an opening balance
  // (which sits first in its day whatever its place), goes last on the day,
  // as if entered again, unless going last leaves something taking out more
  // than was held before it, or a holding no longer starting with units
  // coming in; then it keeps its number on the new date. An opening balance
  // keeps its own number: it ranks first anyway. A yield given as a balance
  // goes last on its day, new or edited, since the balance is the day's end.
  const kept = was?.parts[0]?.movement;
  if (!kept || given.some((part) => "balance" in part)) {
    return writeAt(state.nextEntryOrder);
  }
  if (
    operation.kind === "opening_balance" ||
    (kept.date === operation.date && kept.kind !== "opening_balance")
  ) {
    return writeAt(kept.entry_order);
  }
  const moved = writeAt(state.nextEntryOrder);
  return !moved.result.ok && isOrderRefusal(moved.result.code)
    ? writeAt(kept.entry_order)
    : moved;
}

// A new instrument holding in an account and portfolio, first in the list.
function createdHolding(
  state: PrototypeState,
  account: SourceConnectionRow,
  instrument: InstrumentRow,
  portfolio: PortfolioRow,
  { id, quantity }: { id: string; quantity: string },
): PrototypeState {
  const { holding } = rowOf(
    id,
    {
      asset_class: "instrument",
      instrument_symbol: instrument.symbol,
      amount: quantity,
      currency: null,
      annual_rate: null,
      started_on: null,
      matures_on: null,
      valued_on: null,
      label: null,
    },
    {
      account: { id: account.id, institution: account.institution },
      portfolio,
      instrumentType: null,
    },
  );
  return {
    ...state,
    holdings: [
      {
        holding,
        accountId: account.id,
        portfolioId: portfolio.id,
        closed: false,
      },
      ...state.holdings,
    ],
  };
}

// A manual price, replacing the one the instrument had on that date.
export function setPrice(
  state: PrototypeState,
  input: unknown,
): Write<PriceResult> {
  const parsed = manualPriceSchema.safeParse(input);
  if (!parsed.success) return refused(state, { ok: false, code: "invalid" });
  const price = parsed.data;
  const admitted = admitManualPrice(price, state.today);
  if (!admitted.ok) return refused(state, admitted);
  return {
    state: {
      ...state,
      manualPrices: [
        ...state.manualPrices.filter(
          (each) =>
            each.symbol !== price.symbol ||
            each.price_date !== price.price_date,
        ),
        price,
      ],
    },
    result: { ok: true },
  };
}

// A holding and every movement it has. An operation it shared keeps its other
// portfolios' parts. A holding with a transfer is refused: the transfer's
// other side would be left alone.
export function deleteHolding(
  state: PrototypeState,
  id: string,
): Write<HoldingDeleteResult> {
  if (!state.holdings.some((each) => each.holding.id === id)) {
    return refused(state, { ok: false, code: "not_found" });
  }
  if ((state.movements.get(id) ?? []).some(({ kind }) => kind === "transfer")) {
    return refused(state, { ok: false, code: "holding_has_transfers" });
  }
  return { state: removeHolding(state, id), result: { ok: true, id } };
}

function removeHolding(state: PrototypeState, id: string): PrototypeState {
  const holdings = state.holdings.filter((each) => each.holding.id !== id);
  // A holding with no movements leaves the movements map the same object,
  // so nothing that watches it sees a change.
  if (!state.movements.has(id)) return { ...state, holdings };
  const movements = new Map(state.movements);
  movements.delete(id);
  // The holdings it replayed with load their tables again: an operation it
  // shared shows one part fewer.
  const revisions = bumpGroup(state, id);
  revisions.delete(id);
  return { ...state, holdings, movements, revisions };
}

// Every part of an operation, each holding re-admitted without it: refused
// when a later sale would then sell more than was held, or a holding would no
// longer start with units coming in. A holding left with no movement goes.
export function deleteOperation(
  state: PrototypeState,
  operationId: string,
): Write<MovementResult> {
  let next = state;
  let found = false;
  for (const [holdingId, own] of state.movements) {
    if (!own.some((each) => each.operation_id === operationId)) continue;
    found = true;
    const kept = own.filter((each) => each.operation_id !== operationId);
    if (kept.length === 0) {
      next = removeHolding(next, holdingId);
      continue;
    }
    const admitted = admitMovements({ prior: null, after: kept });
    if (!admitted.ok) {
      return refused(state, { ok: false, code: admitted.code });
    }
    const archived = archivedHome(next, holdingId);
    if (exactOf(admitted.quantity).n > 0n && archived) {
      return refused(state, { ok: false, code: archived });
    }
    next = withMovements(next, holdingId, kept, admitted.quantity);
  }
  if (!found) return refused(state, { ok: false, code: "not_found" });
  return { state: next, result: { ok: true, id: operationId } };
}

// The manual price an instrument had on a date.
export function deletePrice(
  state: PrototypeState,
  symbol: string,
  date: string,
): Write<PriceResult> {
  const manualPrices = state.manualPrices.filter(
    (each) => each.symbol !== symbol || each.price_date !== date,
  );
  return manualPrices.length === state.manualPrices.length
    ? refused(state, { ok: false, code: "invalid" })
    : { state: { ...state, manualPrices }, result: { ok: true } };
}
