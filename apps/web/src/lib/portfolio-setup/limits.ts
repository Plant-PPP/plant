import type { RouteHref } from "@/lib/navigation";

// The longest name each table's CHECK accepts, pinned to the migrations by
// limits.test.ts.
export const NAME_LIMITS = {
  portfolios: { name: 40 },
  source_connections: { institution: 60 },
  holdings: { label: 80 },
} as const;

export type SetupTable = keyof typeof NAME_LIMITS;

export type SetupPage = Extract<RouteHref, "/accounts" | "/assets" | "/debts">;

// The page that lists each table's rows, revalidated after a write.
export const PAGE_BY_TABLE: Record<SetupTable, SetupPage> = {
  portfolios: "/accounts",
  source_connections: "/accounts",
  holdings: "/assets",
};

// The most active rows a list section shows, and the archived rows one page
// shows.
export const PAGE_ROW_LIMIT = 300;
export const ARCHIVED_ROW_LIMIT = 50;

// The most sales the sales tab shows for a year, and the movements one page
// of a movement list shows.
export const SALES_LIMIT = 100;
export const MOVEMENTS_PAGE = 20;
