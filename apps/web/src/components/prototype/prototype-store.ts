import {
  admitMovement,
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
  replay,
  type ReferenceDollar,
  type StoredQuotes,
  snapshotOn,
  takesMovements,
  UNIT_FX_KINDS,
} from "@plant/core";
import { type Exact, exactOf, plus, toDecimal } from "@plant/shared";

import { rowOf } from "@/components/holdings/holding-fields";
import { type AssetsFilter, matchesFilter } from "@/lib/holdings/assets-filter";
import type {
  MovementLine,
  MovementResult,
  MovementScope,
  MovementsPage,
  SaleLine,
  SalesSlice,
} from "@/lib/holdings/movements-input";
import type {
  HoldingRow,
  HoldingsView,
  InstrumentRow,
} from "@/lib/holdings/read";
import {
  holdingInsertSchema,
  holdingUpdateSchema,
  movementInputSchema,
} from "@/lib/holdings/schemas";
import { MOVEMENTS_PAGE } from "@/lib/portfolio-setup/limits";
import type {
  PortfolioRow,
  SourceConnectionRow,
} from "@/lib/portfolio-setup/read";
import type { WriteResult } from "@/lib/portfolio-setup/write-result";
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
  // Newest first, as the real page lists them.
  holdings: StoredHolding[];
  // Each holding's movements, oldest first; a new array on every change.
  movements: ReadonlyMap<string, readonly Movement[]>;
  revisions: ReadonlyMap<string, number>;
  quotes: StoredQuotes;
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
    holdings: fixtures.holdings.map((row) => ({
      holding: row.holding,
      accountId: row.account.id,
      portfolioId: row.portfolio.id,
      closed: fixtures.closed.includes(row.id),
    })),
    movements,
    revisions: new Map([...movements.keys()].map((id) => [id, 0])),
    quotes: fixtures.quotes,
  };
}

// --- Reads -----------------------------------------------------------------

function rowOfStored(
  state: PrototypeState,
  stored: StoredHolding,
): HoldingRow | null {
  const account = state.accounts.find(({ id }) => id === stored.accountId);
  const portfolio = state.portfolios.find(
    ({ id }) => id === stored.portfolioId,
  );
  if (!account || !portfolio) return null;
  return {
    id: stored.holding.id,
    holding: stored.holding,
    account: { id: account.id, institution: account.institution },
    portfolio: { id: portfolio.id, name: portfolio.name },
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

// Each holding's steps in a unit, kept while its movements stay the same
// array.
const stepCache = new WeakMap<
  readonly Movement[],
  Map<string, readonly LedgerStep[]>
>();

export function stepsOf(
  state: PrototypeState,
  holdingId: string,
  unit: Denominator,
): readonly LedgerStep[] {
  const movements = state.movements.get(holdingId) ?? [];
  let byUnit = stepCache.get(movements);
  if (!byUnit) {
    byUnit = new Map();
    stepCache.set(movements, byUnit);
  }
  const key = `${unit}:${state.referenceDollar}`;
  const cached = byUnit.get(key);
  if (cached) return cached;
  const steps = replay(movements, unit, state.referenceDollar);
  byUnit.set(key, steps);
  return steps;
}

export function positionsOf(
  state: PrototypeState,
  unit: Denominator,
): Map<string, Position> {
  const positions = new Map<string, Position>();
  for (const [holdingId, movements] of state.movements) {
    if (movements.length === 0) continue;
    positions.set(
      holdingId,
      stepsOf(state, holdingId, unit).at(-1)?.position ?? EMPTY_POSITION,
    );
  }
  return positions;
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

const sum = (values: (string | null)[]): string | null =>
  values.includes(null)
    ? null
    : toDecimal(plus(...values.map((value) => exactOf(value!))), 8);

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
  const lines: SaleLine[] = [];
  if (year !== null) {
    for (const row of allRows(state)) {
      if (!matchesFilter(row, filter, names)) continue;
      const movements = state.movements.get(row.id) ?? [];
      const steps = stepsOf(state, row.id, unit);
      movements.forEach((movement, index) => {
        if (movement.kind !== "sale" || !movement.date.startsWith(year)) return;
        lines.push({ movement, sale: steps[index]?.sale ?? null, row });
      });
    }
  }
  lines.sort((a, b) => compareMovements(b.movement, a.movement));
  return {
    rows: lines.slice(0, limit),
    truncated: lines.length > limit,
    totals: {
      count: lines.length,
      gross: sum(lines.map((line) => line.sale?.gross ?? null)),
      charges: sum(
        lines.flatMap((line) =>
          line.sale ? [line.sale.fees, line.sale.taxes] : [null],
        ),
      ),
      result: sum(lines.map((line) => line.sale?.result ?? null)),
    },
  };
}

const negated = (x: Exact): Exact => ({ n: -x.n, d: x.d });
const minus = (a: Exact, b: Exact): string => toDecimal(plus(a, negated(b)), 8);
const chargesOf = (money: PositionMoney): Exact =>
  plus(exactOf(money.fees), exactOf(money.taxes));

// A movement's line from its step and the position before it: what its step
// added to the cost (or income), or took from it on a sale.
function lineOf(
  movement: Movement,
  before: Position,
  step: LedgerStep,
): MovementLine {
  const was = before.money;
  const now = step.position.money;
  if (!was || !now) return { movement, cost: null, charges: null };
  const charges = minus(chargesOf(now), chargesOf(was));
  if (step.sale) return { movement, cost: step.sale.cost, charges };
  const field =
    movement.kind === "dividend" || movement.kind === "coupon"
      ? "income"
      : "cost";
  return {
    movement,
    cost: minus(exactOf(now[field]), exactOf(was[field])),
    charges,
  };
}

function inScope(row: HoldingRow, scope: MovementScope): boolean {
  if ("holdingId" in scope) return row.id === scope.holdingId;
  if ("accountId" in scope) return row.account.id === scope.accountId;
  return row.portfolio.id === scope.portfolioId;
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
  });
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
  // A holding with movements keeps the quantity they leave.
  const hasMovements = (state.movements.get(id)?.length ?? 0) > 0;
  const holding = holdingSchema.parse({
    ...stored.holding,
    ...columns,
    ...(hasMovements && { amount: stored.holding.amount }),
    portfolio_id,
  });
  return {
    state: {
      ...state,
      holdings: state.holdings.map((each) =>
        each === stored
          ? { ...each, holding, portfolioId: portfolio_id }
          : each,
      ),
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
    revisions: new Map(state.revisions).set(
      holdingId,
      (state.revisions.get(holdingId) ?? 0) + 1,
    ),
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

// Records a new movement (`replacing` none) or an edit, admitted against the
// holding's other movements, with the rates of its date.
export function writeMovement(
  state: PrototypeState,
  input: unknown,
  { id, replacing }: { id: string; replacing?: string },
): Write<MovementResult> {
  const parsed = movementInputSchema.safeParse(input);
  if (!parsed.success) return refused(state, { ok: false, code: "invalid" });
  const stored = state.holdings.find(
    (each) => each.holding.id === parsed.data.holding_id,
  );
  if (!stored || !takesMovements(stored.holding)) {
    return refused(state, { ok: false, code: "not_found" });
  }
  const own = state.movements.get(stored.holding.id) ?? [];
  if (replacing !== undefined && !own.some((each) => each.id === replacing)) {
    return refused(state, { ok: false, code: "not_found" });
  }
  const others = own.filter((each) => each.id !== replacing);
  const rates = snapshotOn(state.quotes, parsed.data.date, {
    fxKinds: UNIT_FX_KINDS,
    symbols: [],
  }).snapshot.fx;
  const draft = { ...parsed.data, id, rates };
  const admitted = admitMovement({ prior: null, after: others }, draft, {
    today: state.today,
  });
  if (!admitted.ok) return refused(state, { ok: false, code: admitted.code });
  const movements = [...others, draft as Movement].sort(compareMovements);
  return {
    state: withMovements(
      state,
      stored.holding.id,
      movements,
      admitted.quantity,
    ),
    result: { ok: true, id },
  };
}
