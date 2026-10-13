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
    client
      .from("holdings")
      .select(
        "id, source_connection_id, portfolio_id, asset_class, instrument_symbol, " +
          "amount:amount::text, currency, annual_rate, started_on, matures_on, valued_on, " +
          "label, movements_revision, archived_at",
      )
      .eq("asset_class", "instrument")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false }),
    client
      .from("movements")
      .select(MOVEMENT_COLUMNS)
      .order("date")
      .order("rank")
      .order("id")
      .limit(LEDGER_MOVEMENT_LIMIT + 1),
    client
      .from("instruments")
      .select("symbol, name, currency, type, aliases")
      .order("symbol"),
    client
      .from("manual_prices")
      .select("symbol, price_date, price:price::text, currency"),
    client.from("manual_rates").select("kind, rate_date, sell:sell::text"),
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
  const holdingRows = checked("holdings", holdingsResult) as unknown as Record<
    string,
    unknown
  >[];
  const movementRows = checked(
    "movements",
    movementsResult,
  ) as unknown as Record<string, unknown>[];
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
  const manualPrices = checked(
    "manual_prices",
    pricesResult,
  ) as unknown as ManualPrice[];
  const manualRates = checked(
    "manual_rates",
    ratesResult,
  ) as unknown as ManualRate[];

  const truncated = movementRows.length > LEDGER_MOVEMENT_LIMIT;
  const movements = new Map<string, Movement[]>();
  for (const row of movementRows.slice(0, LEDGER_MOVEMENT_LIMIT)) {
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
