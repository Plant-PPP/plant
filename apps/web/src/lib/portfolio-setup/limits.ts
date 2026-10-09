// The longest name each table's CHECK accepts, pinned to the migrations by
// limits.test.ts.
export const NAME_LIMITS = {
  portfolios: { name: 40 },
  holders: { name: 80 },
  source_connections: { institution: 60 },
} as const;

export type SetupTable = keyof typeof NAME_LIMITS;

// The most active rows a card lists, and the archived rows one page shows.
export const PAGE_ROW_LIMIT = 300;
export const ARCHIVED_ROW_LIMIT = 50;
