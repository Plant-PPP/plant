import type { ListView } from "@/lib/portfolio-setup/read";

// A one-page list with no archived rows, changed where a test says.
export function listView<Row>(
  change: Partial<ListView<Row>> = {},
): ListView<Row> {
  return {
    active: [],
    activeTruncated: false,
    archived: [],
    archivedPage: null,
    archivedFirstHref: null,
    archivedNextHref: null,
    ...change,
  };
}
