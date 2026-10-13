import "server-only";
import { type Database, logList } from "@plant/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
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
import {
  ARCHIVED_ROW_LIMIT,
  PAGE_ROW_LIMIT,
  type SetupPage,
  type SetupTable,
} from "./limits";

export type PortfolioRow = { id: string; name: string };

// An account with its default portfolio, marked when archived: only an
// archived account can point at one.
export type SourceConnectionRow = {
  id: string;
  institution: string;
  includeInTaxReport: boolean;
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
export type SourceConnectionsView = ListView<SourceConnectionRow>;

export type ReadContext = {
  userId: string;
  requestId: string | undefined;
  page: SetupPage;
  params: KeysetParams;
};

// The fields every line a page's read logs carries.
export function contextFields({ userId, requestId, page }: ReadContext) {
  return {
    [REQUEST_ID_FIELD]: requestId,
    "enduser.id": userId,
    "plant.page": page,
  };
}

export type ListOptions = {
  // False reads only the active rows; the archived list comes back empty.
  archived?: boolean;
};

export type ListSpec<Row> = {
  table: SetupTable;
  // The search param that pages the archived rows.
  param: string;
  columns: string;
  toRow: (data: Record<string, unknown>) => Row;
  // Leaves out the rows holding nothing: an instrument holding sold out,
  // which the pages with movements show apart.
  heldOnly?: boolean;
};

const EVENT = "portfolio_setup.read";

// The user's active rows of a table, newest first, and one page of the
// archived ones, latest archive first. Both reads filter by the user besides
// RLS. A failed read, or a row toRow refuses, is logged here and thrown as a
// LoggedError, which the (app) error page shows with a retry.
export async function readList<Row>(
  client: SupabaseClient<Database>,
  { table, param, columns, toRow, heldOnly = false }: ListSpec<Row>,
  context: ReadContext,
  { archived: withArchived = true }: ListOptions = {},
): Promise<ListView<Row>> {
  const { userId, params } = context;
  const fields = {
    ...contextFields(context),
    "plant.portfolio_setup.table": table,
  };
  // A list read without its archived rows ignores their cursor.
  const parsed = withArchived
    ? parseKeyset(params[param])
    : ({ ok: true, cursor: null } as const);
  if (!parsed.ok) {
    serverLog.warn(EVENT, { ...fields, "plant.outcome": "invalid_cursor" });
  }
  const cursor: Keyset | null = parsed.ok ? parsed.cursor : null;

  const held = <Q extends { filter: (...args: string[]) => Q }>(query: Q) =>
    heldOnly ? query.filter("amount", "gt", "0") : query;
  const activeQuery = held(
    client
      .from(table)
      .select(columns)
      .eq("user_id", userId)
      .is("archived_at", null),
  )
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(PAGE_ROW_LIMIT + 1);
  const archivedQuery = () => {
    let query = held(
      client
        .from(table)
        .select(`${columns}, archived_at`)
        .eq("user_id", userId)
        .not("archived_at", "is", null),
    );
    if (cursor) {
      query = query
        .lte("archived_at", cursor.at)
        .or(keysetFilter("archived_at", cursor));
    }
    return query
      .order("archived_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(ARCHIVED_ROW_LIMIT + 1);
  };
  const [active, archived] = await Promise.all([
    activeQuery,
    withArchived ? archivedQuery() : { data: [], error: null, status: 200 },
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
  const rowOf = (data: Record<string, unknown>): Row => {
    try {
      return toRow(data);
    } catch (error) {
      const isZod = error instanceof z.ZodError;
      serverLog.error(
        EVENT,
        {
          ...fields,
          "plant.outcome": "invalid_row",
          "plant.portfolio_setup.row_id":
            typeof data.id === "string" ? data.id : undefined,
          // The columns a schema refused, never their values.
          ...(isZod && {
            "plant.portfolio_setup.columns": logList(
              error.issues.map((issue) => String(issue.path[0] ?? "row")),
            ),
          }),
        },
        isZod ? new PortfolioSetupError("invalid_row") : error,
      );
      throw new LoggedError("portfolio_setup.read_failed");
    }
  };
  return {
    active: activeRows.slice(0, PAGE_ROW_LIMIT).map(rowOf),
    activeTruncated: activeRows.length > PAGE_ROW_LIMIT,
    archived: archivedRows.slice(0, ARCHIVED_ROW_LIMIT).map(rowOf),
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

function portfolioRow(data: Record<string, unknown>): PortfolioRow {
  return { id: String(data.id), name: String(data.name) };
}

function linkedPortfolio(data: unknown): PortfolioRow & { archived: boolean } {
  const row = data as { id: string; name: string; archived_at: string | null };
  return { id: row.id, name: row.name, archived: row.archived_at !== null };
}

export function readPortfolios(
  client: SupabaseClient<Database>,
  context: ReadContext,
  options?: ListOptions,
): Promise<PortfoliosView> {
  return readList(
    client,
    {
      table: "portfolios",
      param: "portfolios",
      columns: "id, name",
      toRow: portfolioRow,
    },
    context,
    options,
  );
}

// The portfolio is embedded through the composite foreign key, so RLS on
// portfolios applies to it too.
export function readSourceConnections(
  client: SupabaseClient<Database>,
  context: ReadContext,
  options?: ListOptions,
): Promise<SourceConnectionsView> {
  return readList(
    client,
    {
      table: "source_connections",
      param: "accounts",
      columns:
        "id, institution, include_in_tax_report, " +
        "portfolio:portfolios!source_connections_user_id_default_portfolio_id_fkey(id, name, archived_at)",
      toRow: (data) => ({
        id: String(data.id),
        institution: String(data.institution),
        includeInTaxReport: data.include_in_tax_report === true,
        portfolio: linkedPortfolio(data.portfolio),
      }),
    },
    context,
    options,
  );
}
