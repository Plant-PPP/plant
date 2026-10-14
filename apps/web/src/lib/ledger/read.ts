import "server-only";
import {
  holdingSchema,
  INSTRUMENT_TYPES,
  type ManualPrice,
  type ManualRate,
  type Movement,
  movementSchema,
  type ReferenceDollar,
  type StoredQuotes,
} from "@plant/core";
import { Constants, type Database } from "@plant/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { InstrumentRow } from "@/lib/holdings/read";
import type {
  PortfolioRow,
  SourceConnectionRow,
} from "@/lib/portfolio-setup/read";
import { MAX_ROWS } from "@/lib/quotes/quote-reader";
import { classifyPostgrestResult } from "@/lib/supabase/postgrest-write";

import { type Ledger, MANUAL, type StoredHolding } from "./ledger";

type Client = SupabaseClient<Database>;

// More movements than a user types in years; past it the ledger is cut and
// the page says so.
export const LEDGER_MOVEMENT_LIMIT = 20_000;

// Where a read failed, for the caller's log; never a value.
export type LedgerStep =
  | "accounts"
  | "portfolios"
  | "holdings"
  | "movements"
  | "instruments"
  | "manual_prices"
  | "manual_rates";

export class LedgerReadError extends Error {
  constructor(
    readonly step: LedgerStep,
    readonly code: string,
  ) {
    super(`ledger read failed at ${step}: ${code}`);
  }
}

// Every row of a read, page by page: PostgREST answers at most MAX_ROWS rows
// a request and cuts the rest without saying so. Past `limit` rows the read
// stops and says it was cut.
async function allRows<T>(
  step: LedgerStep,
  page: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: unknown; status: number }>,
  limit: number,
): Promise<{ rows: T[]; cut: boolean }> {
  const rows: T[] = [];
  for (let from = 0; ; from += MAX_ROWS) {
    const data = checked(step, await page(from, from + MAX_ROWS - 1));
    rows.push(...data);
    if (rows.length > limit) return { rows: rows.slice(0, limit), cut: true };
    if (data.length < MAX_ROWS) return { rows, cut: false };
  }
}

// Every movement in core's order (date, rank, id), each page after the last
// row read: a write committed between two pages cannot repeat or skip a row
// the way an offset would. Past `limit` rows the read stops and says it was
// cut.
async function allMovements(
  client: Client,
  limit: number,
): Promise<{ rows: Record<string, unknown>[]; cut: boolean }> {
  const rows: Record<string, unknown>[] = [];
  let last: Record<string, unknown> | undefined;
  for (;;) {
    let query = client.from("movements").select(`${MOVEMENT_COLUMNS}, rank`);
    if (last) {
      const { date, rank, id } = last as {
        date: string;
        rank: number;
        id: string;
      };
      query = query
        .gte("date", date)
        .or(
          `date.gt.${date},and(date.eq.${date},rank.gt.${rank}),and(date.eq.${date},rank.eq.${rank},id.gt.${id})`,
        );
    }
    const data = checked(
      "movements",
      await query.order("date").order("rank").order("id").limit(MAX_ROWS),
    ) as unknown as Record<string, unknown>[];
    rows.push(...data);
    if (rows.length > limit) return { rows: rows.slice(0, limit), cut: true };
    if (data.length < MAX_ROWS) return { rows, cut: false };
    last = data.at(-1);
  }
}

function checked<T>(
  step: LedgerStep,
  result: { data: T | null; error: unknown; status: number },
): T {
  const failure = classifyPostgrestResult(
    result as Parameters<typeof classifyPostgrestResult>[0],
    200,
  );
  if (failure || result.data === null) {
    throw new LedgerReadError(step, failure?.code ?? "no_data");
  }
  return result.data;
}

// A movement's columns by kind: the row carries every kind's, null where
// they do not apply, and core's schema takes only its kind's.
const KIND_COLUMNS: Record<Movement["kind"], readonly string[]> = {
  opening_balance: ["quantity", "price"],
  purchase: ["quantity", "price"],
  sale: ["quantity", "price"],
  dividend: ["amount"],
  coupon: ["amount"],
  adjustment: ["direction", "quantity", "price"],
  transfer: ["direction", "quantity", "price"],
  yield: ["direction", "quantity", "price"],
};

const COMMON_COLUMNS = [
  "id",
  "holding_id",
  "operation_id",
  "entry_order",
  "kind",
  "date",
  "currency",
  "charges",
  "reference",
  "note",
  "rates",
] as const;

// Amounts are selected as text, so they stay exact decimal strings.
export const MOVEMENT_COLUMNS =
  "id, holding_id, operation_id, entry_order, kind, date, currency, direction, " +
  "quantity:quantity::text, price:price::text, amount:amount::text, charges, " +
  "reference, note, rates";

// A stored movement as core reads it; the JSON columns are checked here,
// since the database checks only their shape.
export function movementOfRow(row: Record<string, unknown>): Movement {
  const kind = z
    .enum(Object.keys(KIND_COLUMNS) as [Movement["kind"]])
    .parse(row.kind);
  const picked = Object.fromEntries(
    [...COMMON_COLUMNS, ...KIND_COLUMNS[kind]].map((column) => [
      column,
      row[column],
    ]),
  );
  return movementSchema.parse(picked);
}

const accountSchema = z.object({
  id: z.string(),
  institution: z.string(),
  include_in_tax_report: z.boolean(),
  archived_at: z.string().nullable(),
  portfolio: z.object({
    id: z.string(),
    name: z.string(),
    archived_at: z.string().nullable(),
  }),
});

// The ledger, whether its movements were cut at LEDGER_MOVEMENT_LIMIT, and
// the instrument of every instrument holding, archived ones included.
export type LedgerRead = {
  ledger: Ledger;
  truncated: boolean;
  symbolOf: ReadonlyMap<string, string>;
};

const holdingRowSchema = z.object({
  id: z.string(),
  instrument_symbol: z.string(),
  source_connection_id: z.string(),
  portfolio_id: z.string(),
  amount: z.string(),
  movements_revision: z.number().int().nonnegative(),
  archived_at: z.string().nullable(),
});

// Everything the pages with movements read about a user: their accounts and
// portfolios, their open instrument holdings with every movement, the
// revision of every instrument holding (archived ones included, as
// write_operation expects them), the instruments and the manual prices and
// rates. `quotes` are the stored quotes a write values its date at.
export async function readLedger(
  client: Client,
  {
    today,
    referenceDollar,
    quotes = { fxRates: [], prices: [] },
  }: { today: string; referenceDollar: ReferenceDollar; quotes?: StoredQuotes },
): Promise<LedgerRead> {
  // The revisions are read before the movements: a write committed in
  // between leaves a revision behind, and write_operation refuses it, where
  // the other order would admit a write against a history read without it.
  const holdingsRead = allRows(
    "holdings",
    (from, to) =>
      client
        .from("holdings")
        .select(
          "id, source_connection_id, portfolio_id, asset_class, instrument_symbol, " +
            "amount:amount::text, currency, annual_rate, started_on, matures_on, valued_on, " +
            "label, movements_revision, archived_at",
        )
        .eq("asset_class", "instrument")
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to),
    LEDGER_MOVEMENT_LIMIT,
  );
  const [
    accountsResult,
    portfoliosResult,
    holdingsResult,
    movementsResult,
    instrumentsResult,
    pricesResult,
    ratesResult,
  ] = await Promise.all([
    client
      .from("source_connections")
      .select(
        "id, institution, include_in_tax_report, archived_at, " +
          "portfolio:portfolios!source_connections_user_id_default_portfolio_id_fkey(id, name, archived_at)",
      )
      .order("created_at", { ascending: false }),
    client
      .from("portfolios")
      .select("id, name, archived_at")
      .order("created_at"),
    holdingsRead,
    holdingsRead.then(() => allMovements(client, LEDGER_MOVEMENT_LIMIT)),
    client
      .from("instruments")
      .select("symbol, name, currency, type, aliases")
      .order("symbol"),
    allRows(
      "manual_prices",
      (from, to) =>
        client
          .from("manual_prices")
          .select("symbol, price_date, price:price::text, currency")
          .order("symbol")
          .order("price_date")
          .range(from, to),
      LEDGER_MOVEMENT_LIMIT,
    ),
    allRows(
      "manual_rates",
      (from, to) =>
        client
          .from("manual_rates")
          .select("kind, rate_date, sell:sell::text")
          .order("kind")
          .order("rate_date")
          .range(from, to),
      LEDGER_MOVEMENT_LIMIT,
    ),
  ]);

  const accounts = z
    .array(accountSchema)
    .parse(checked("accounts", accountsResult));
  const portfolios = z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        archived_at: z.string().nullable(),
      }),
    )
    .parse(checked("portfolios", portfoliosResult));
  const holdingRows = holdingsResult.rows as unknown as Record<
    string,
    unknown
  >[];
  const movementRows = movementsResult.rows as unknown as Record<
    string,
    unknown
  >[];
  const instruments: InstrumentRow[] = z
    .array(
      z.object({
        symbol: z.string(),
        name: z.string(),
        currency: z.enum(Constants.public.Enums.currency),
        type: z.enum(INSTRUMENT_TYPES),
        aliases: z.array(z.string()).default([]),
      }),
    )
    .parse(checked("instruments", instrumentsResult));
  const manualPrices = pricesResult.rows as unknown as ManualPrice[];
  const manualRates = ratesResult.rows as unknown as ManualRate[];

  // A ledger read in part would admit writes against a history the database
  // does not have.
  const truncated =
    holdingsResult.cut ||
    movementsResult.cut ||
    pricesResult.cut ||
    ratesResult.cut;
  const movements = new Map<string, Movement[]>();
  for (const row of movementRows) {
    const movement = movementOfRow(row);
    const own = movements.get(movement.holding_id) ?? [];
    own.push(movement);
    movements.set(movement.holding_id, own);
  }

  const revisions = new Map<string, number>();
  const symbolOf = new Map<string, string>();
  const holdings: StoredHolding[] = [];
  for (const data of holdingRows) {
    const row = holdingRowSchema.parse(data);
    revisions.set(row.id, row.movements_revision);
    symbolOf.set(row.id, row.instrument_symbol);
    if (row.archived_at !== null) continue;
    // A holding sold out holds 0 units, which no holding schema takes. Its
    // amount is never read: the replay of its movements says what it holds.
    const closed = Number(row.amount) === 0;
    const amount = closed ? "1" : row.amount;
    holdings.push({
      holding: holdingSchema.parse({ ...data, amount }),
      accountId: row.source_connection_id,
      portfolioId: row.portfolio_id,
      closed,
      origin: MANUAL,
    });
  }

  const account = (
    each: z.infer<typeof accountSchema>,
  ): SourceConnectionRow => ({
    id: each.id,
    institution: each.institution,
    includeInTaxReport: each.include_in_tax_report,
    portfolio: {
      id: each.portfolio.id,
      name: each.portfolio.name,
      archived: each.portfolio.archived_at !== null,
    },
  });
  const portfolio = ({ id, name }: PortfolioRow): PortfolioRow => ({
    id,
    name,
  });

  const entryOrders = movementRows.map((row) => Number(row.entry_order));
  return {
    ledger: {
      today,
      referenceDollar,
      instruments,
      accounts: accounts.filter((each) => !each.archived_at).map(account),
      archivedAccounts: accounts
        .filter((each) => each.archived_at)
        .map(account),
      portfolios: portfolios.filter((each) => !each.archived_at).map(portfolio),
      archivedPortfolios: portfolios
        .filter((each) => each.archived_at)
        .map(portfolio),
      holdings,
      movements,
      nextEntryOrder: Math.max(0, ...entryOrders) + 1,
      revisions,
      quotes,
      manualPrices,
      manualRates,
      operationOrigins: new Map(),
    },
    truncated,
    symbolOf,
  };
}
