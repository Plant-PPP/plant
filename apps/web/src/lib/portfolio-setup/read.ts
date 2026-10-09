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

export type PortfoliosView = {
  active: PortfolioRow[];
  // More active portfolios than PAGE_ROW_LIMIT; the oldest are not shown.
  activeTruncated: boolean;
  archived: PortfolioRow[];
  // Set when the archived list is on a later page, or has one.
  archivedFirstHref: string | null;
  archivedNextHref: string | null;
};

// The param that pages the archived portfolios.
const ARCHIVED_PORTFOLIOS_PARAM = "carteras";

const EVENT = "portfolio_setup.read";

// The user's active portfolios, newest first, and one page of the archived
// ones, latest archive first. Both reads filter by the user besides RLS. A
// failed read is logged here and thrown as a LoggedError, which the (app)
// error page shows with a retry.
export async function readPortfolios(
  client: SupabaseClient<Database>,
  {
    userId,
    requestId,
    params,
  }: {
    userId: string;
    requestId: string | undefined;
    params: KeysetParams;
  },
): Promise<PortfoliosView> {
  const fields = { [REQUEST_ID_FIELD]: requestId, "enduser.id": userId };
  const parsed = parseKeyset(params[ARCHIVED_PORTFOLIOS_PARAM]);
  if (!parsed.ok) {
    serverLog.warn(EVENT, {
      ...fields,
      "plant.portfolio_setup.table": "portfolios",
      "plant.outcome": "invalid_cursor",
    });
  }
  const cursor: Keyset | null = parsed.ok ? parsed.cursor : null;

  const activeQuery = client
    .from("portfolios")
    .select("id, name")
    .eq("user_id", userId)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(PAGE_ROW_LIMIT + 1);
  let archivedQuery = client
    .from("portfolios")
    .select("id, name, archived_at")
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

  const failures = [active, archived].map((result) =>
    classifyPostgrestResult(result, 200),
  );
  const [activeFailure, archivedFailure] = failures;
  const failure = activeFailure ?? archivedFailure;
  if (failure) {
    serverLog.error(
      EVENT,
      {
        ...fields,
        "plant.portfolio_setup.table": "portfolios",
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

  const activeRows = active.data ?? [];
  const archivedRows = archived.data ?? [];
  const lastShown = archivedRows[ARCHIVED_ROW_LIMIT - 1];
  return {
    active: activeRows.slice(0, PAGE_ROW_LIMIT).map(({ id, name }) => ({
      id,
      name,
    })),
    activeTruncated: activeRows.length > PAGE_ROW_LIMIT,
    archived: archivedRows
      .slice(0, ARCHIVED_ROW_LIMIT)
      .map(({ id, name }) => ({ id, name })),
    archivedFirstHref: cursor
      ? firstPageHref(params, ARCHIVED_PORTFOLIOS_PARAM)
      : null,
    archivedNextHref:
      archivedRows.length > ARCHIVED_ROW_LIMIT && lastShown?.archived_at
        ? keysetHref(params, ARCHIVED_PORTFOLIOS_PARAM, {
            at: lastShown.archived_at,
            id: lastShown.id,
          })
        : null,
  };
}
