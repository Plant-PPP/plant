// The longest name each table's CHECK accepts, pinned to the migrations by
// limits.test.ts.
export const NAME_LIMITS = {
  portfolios: { name: 40 },
} as const;

// The most active rows a card lists, and the archived rows one page shows.
export const PAGE_ROW_LIMIT = 300;
export const ARCHIVED_ROW_LIMIT = 50;
