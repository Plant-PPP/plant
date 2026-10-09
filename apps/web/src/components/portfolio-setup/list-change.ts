import type { DataTableRow } from "@/components/ui/data-table";
import {
  ARCHIVED_ROW_LIMIT,
  PAGE_ROW_LIMIT,
} from "@/lib/portfolio-setup/limits";
import type {
  ListView,
  NamedRow,
  SourceConnectionRow,
} from "@/lib/portfolio-setup/read";
import { type AccountLink, embeds } from "./accounts-using";

// What the user just did to one list, shown before the server confirms it.
export type ListChange<Row> =
  | { kind: "create"; row: Row }
  | { kind: "update"; row: Row }
  | { kind: "archive"; id: string }
  | { kind: "restore"; row: Row };

export type SetupLists = {
  sourceConnections: ListView<SourceConnectionRow>;
  portfolios: ListView<NamedRow>;
  holders: ListView<NamedRow>;
};

export type SetupChange =
  | { list: "sourceConnections"; change: ListChange<SourceConnectionRow> }
  | { list: "portfolios" | "holders"; change: ListChange<NamedRow> };

let lastId = 0;

// The id of a row created on the page, until the server's row replaces it.
export function temporaryId(): string {
  lastId += 1;
  return `new-${lastId}`;
}

// Prepends to the active rows, newest first like the server, within its cap.
function prepend<Row extends DataTableRow>(
  view: ListView<Row>,
  row: Row,
): Pick<ListView<Row>, "active" | "activeTruncated"> {
  const active = [row, ...view.active];
  return {
    active: active.slice(0, PAGE_ROW_LIMIT),
    activeTruncated: view.activeTruncated || active.length > PAGE_ROW_LIMIT,
  };
}

// A change applied again over the server's refreshed list shows the same
// rows: archiving or restoring a row already moved changes nothing, and an
// update rewrites the row as it already reads. A create skips a row the list
// already shows by its id.
export function applyChange<Row extends DataTableRow>(
  view: ListView<Row>,
  change: ListChange<Row>,
): ListView<Row> {
  switch (change.kind) {
    case "create": {
      if (view.active.some(({ id }) => id === change.row.id)) return view;
      return { ...view, ...prepend(view, { ...change.row, unsaved: true }) };
    }
    case "update": {
      if (!view.active.some(({ id }) => id === change.row.id)) return view;
      const row = { ...change.row, unsaved: true as const };
      return {
        ...view,
        active: view.active.map((each) => (each.id === row.id ? row : each)),
      };
    }
    case "archive": {
      const row = view.active.find(({ id }) => id === change.id);
      if (!row) return view;
      const active = view.active.filter(({ id }) => id !== change.id);
      // Only the first archived page shows the latest archive; a later page
      // stays as the server paged it.
      const archived =
        view.archivedPage === null &&
        !view.archived.some(({ id }) => id === change.id)
          ? [{ ...row, unsaved: true as const }, ...view.archived].slice(
              0,
              ARCHIVED_ROW_LIMIT,
            )
          : view.archived;
      return { ...view, active, archived };
    }
    case "restore": {
      const archived = view.archived.filter(({ id }) => id !== change.row.id);
      if (view.active.some(({ id }) => id === change.row.id)) {
        return archived.length === view.archived.length
          ? view
          : { ...view, archived };
      }
      // On top until the server places it by creation date.
      return {
        ...view,
        ...prepend(view, { ...change.row, unsaved: true }),
        archived,
      };
    }
  }
}

// The accounts show their portfolio's and holder's names and whether each is
// archived, so a rename or restore reaches them too: either leaves it active
// with its new name.
function linkIn(
  view: ListView<SourceConnectionRow>,
  key: AccountLink,
  row: NamedRow,
): ListView<SourceConnectionRow> {
  const relink = (rows: SourceConnectionRow[]) =>
    rows.some((each) => embeds(each, key, row.id))
      ? rows.map((each) =>
          embeds(each, key, row.id)
            ? {
                ...each,
                [key]: { ...each[key]!, name: row.name, archived: false },
              }
            : each,
        )
      : rows;
  const active = relink(view.active);
  const archived = relink(view.archived);
  return active === view.active && archived === view.archived
    ? view
    : { ...view, active, archived };
}

export function applySetupChange(
  lists: SetupLists,
  { list, change }: SetupChange,
): SetupLists {
  if (list === "sourceConnections") {
    const view = applyChange(lists.sourceConnections, change);
    return view === lists.sourceConnections
      ? lists
      : { ...lists, sourceConnections: view };
  }
  const view = applyChange(lists[list], change);
  const sourceConnections =
    change.kind === "update" || change.kind === "restore"
      ? linkIn(
          lists.sourceConnections,
          list === "portfolios" ? "portfolio" : "holder",
          change.row,
        )
      : lists.sourceConnections;
  return view === lists[list] && sourceConnections === lists.sourceConnections
    ? lists
    : { ...lists, [list]: view, sourceConnections };
}
