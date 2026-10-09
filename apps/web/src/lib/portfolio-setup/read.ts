import "server-only";
import type { Database } from "@plant/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LoggedError } from "@/lib/log/logged-error";
import { serverLog } from "@/lib/log/server-log";
import { REQUEST_ID_FIELD } from "@/lib/request-id";
import {
  firstPageHref,
  type Keyset,
  type KeysetParams,
  keysetFilter,
  keysetHref,
  parseKeyset,
} from "@/lib/supabase/keyset";
import { classifyPostgrestResult } from "@/lib/supabase/postgrest-write";
import { PortfolioSetupError } from "./errors";
import { ARCHIVED_ROW_LIMIT, PAGE_ROW_LIMIT } from "./limits";

export type PortfolioRow = { id: string; name: string };
export type HolderRow = PortfolioRow;

// An account with its holder (null is the user) and default portfolio, each
// marked when archived: only an archived account can point at one.
export type SourceConnectionRow = {
  id: string;
  institution: string;
  includeInTaxReport: boolean;
  holder: (HolderRow & { archived: boolean }) | null;
  portfolio: PortfolioRow & { archived: boolean };
};

export type ListView<Row> = {
  active: Row[];
  // More active rows than PAGE_ROW_LIMIT; the oldest are not shown.
  activeTruncated: boolean;
  archived: Row[];
  // Which archived page is shown: null for the first.
  archivedPage: string | null;
  // Set when the archived list is on a later page, or has one.
  archivedFirstHref: string | null;
  archivedNextHref: string | null;
};

export type PortfoliosView = ListView<PortfolioRow>;
export type HoldersView = ListView<HolderRow>;
export type SourceConnectionsView = ListView<SourceConnectionRow>;

type ReadContext = {
  userId: string;
  requestId: string | undefined;
  params: KeysetParams;
};

type ListSpec<Row> = {
  table: "portfolios" | "holders" | "source_connections";
  // The search param that pages the archived rows.
  param: string;
  columns: string;
  toRow: (data: Record<string, unknown>) => Row;
};

const EVENT = "portfolio_setup.read";

// The user's active rows of a table, newest first, and one page of the
// archived ones, latest archive first. Both reads filter by the user besides
// RLS. A failed read is logged here and thrown as a LoggedError, which the
// (app) error page shows with a retry.
async function readList<Row>(
  client: SupabaseClient<Database>,
  { table, param, columns, toRow }: ListSpec<Row>,
  { userId, requestId, params }: ReadContext,
): Promise<ListView<Row>> {
  const fields = {
    [REQUEST_ID_FIELD]: requestId,
    "enduser.id": userId,
    "plant.portfolio_setup.table": table,
  };
  const parsed = parseKeyset(params[param]);
  if (!parsed.ok) {
    serverLog.warn(EVENT, { ...fields, "plant.outcome": "invalid_cursor" });
  }
  const cursor: Keyset | null = parsed.ok ? parsed.cursor : null;

  const activeQuery = client
    .from(table)
    .select(columns)
    .eq("user_id", userId)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(PAGE_ROW_LIMIT + 1);
  let archivedQuery = client
    .from(table)
    .select(`${columns}, archived_at`)
    .eq("user_id", userId)
    .not("archived_at", "is", null);
  if (cursor) {
    archivedQuery = archivedQuery
      .lte("archived_at", cursor.at)
      .or(keysetFilter("archived_at", cursor));
  }
  const [active, archived] = await Promise.all([
    activeQuery,
    archivedQuery
      .order("archived_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(ARCHIVED_ROW_LIMIT + 1),
  ]);

  const [activeFailure, archivedFailure] = [active, archived].map((result) =>
    classifyPostgrestResult(result, 200),
  );
  const failure = activeFailure ?? archivedFailure;
  if (failure) {
    serverLog.error(
      EVENT,
      {
        ...fields,
        "plant.portfolio_setup.list":
          activeFailure && archivedFailure
            ? "both"
            : activeFailure
              ? "active"
              : "archived",
        "plant.outcome": "error",
      },
      new PortfolioSetupError(failure.code),
    );
    throw new LoggedError("portfolio_setup.read_failed");
  }

  // The select is built from strings, so the client cannot type its rows.
  const activeRows = (active.data ?? []) as unknown as Record<
    string,
    unknown
  >[];
  const archivedRows = (archived.data ?? []) as unknown as (Record<
    string,
    unknown
  > & { id: string; archived_at: string | null })[];
  const lastShown = archivedRows[ARCHIVED_ROW_LIMIT - 1];
  return {
    active: activeRows.slice(0, PAGE_ROW_LIMIT).map(toRow),
    activeTruncated: activeRows.length > PAGE_ROW_LIMIT,
    archived: archivedRows.slice(0, ARCHIVED_ROW_LIMIT).map(toRow),
    archivedPage: cursor ? `${cursor.at},${cursor.id}` : null,
    archivedFirstHref: cursor ? firstPageHref(params, param) : null,
    archivedNextHref:
      archivedRows.length > ARCHIVED_ROW_LIMIT && lastShown?.archived_at
        ? keysetHref(params, param, {
            at: lastShown.archived_at,
            id: lastShown.id,
          })
        : null,
  };
}

function namedRow(data: Record<string, unknown>): PortfolioRow {
  return { id: String(data.id), name: String(data.name) };
}

function linkedRow(data: unknown): PortfolioRow & { archived: boolean } {
  const row = data as { id: string; name: string; archived_at: string | null };
  return { id: row.id, name: row.name, archived: row.archived_at !== null };
}

export function readPortfolios(
  client: SupabaseClient<Database>,
  context: ReadContext,
): Promise<PortfoliosView> {
  return readList(
    client,
    {
      table: "portfolios",
      param: "carteras",
      columns: "id, name",
      toRow: namedRow,
    },
    context,
  );
}

export function readHolders(
  client: SupabaseClient<Database>,
  context: ReadContext,
): Promise<HoldersView> {
  return readList(
    client,
    {
      table: "holders",
      param: "titulares",
      columns: "id, name",
      toRow: namedRow,
    },
    context,
  );
}

// The holder and the portfolio are embedded through the composite foreign
// keys, so RLS on those tables applies to them too.
export function readSourceConnections(
  client: SupabaseClient<Database>,
  context: ReadContext,
): Promise<SourceConnectionsView> {
  return readList(
    client,
    {
      table: "source_connections",
      param: "cuentas",
      columns:
        "id, institution, include_in_tax_report, " +
        "holder:holders!source_connections_user_id_holder_id_fkey(id, name, archived_at), " +
        "portfolio:portfolios!source_connections_user_id_default_portfolio_id_fkey(id, name, archived_at)",
      toRow: (data) => ({
        id: String(data.id),
        institution: String(data.institution),
        includeInTaxReport: data.include_in_tax_report === true,
        holder: data.holder ? linkedRow(data.holder) : null,
        portfolio: linkedRow(data.portfolio),
      }),
    },
    context,
  );
}
