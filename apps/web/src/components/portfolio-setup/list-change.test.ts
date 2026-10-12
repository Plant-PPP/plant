import {
  ARCHIVED_ROW_LIMIT,
  PAGE_ROW_LIMIT,
} from "@/lib/portfolio-setup/limits";
import type {
  PortfolioRow,
  SourceConnectionRow,
} from "@/lib/portfolio-setup/read";
import { idSchema } from "@/lib/portfolio-setup/schemas";
import { listView } from "@/test/list-view";
import {
  type SetupLists,
  applyChange,
  applySetupChange,
  temporaryId,
} from "./list-change";

const principal: PortfolioRow = { id: "p1", name: "Principal" };
const largo: PortfolioRow = { id: "p2", name: "Largo plazo" };
const corto: PortfolioRow = { id: "p3", name: "Corto plazo" };

const rows = (count: number, prefix: string): PortfolioRow[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `${prefix}${index}`,
    name: `${prefix}${index}`,
  }));

describe("applyChange", () => {
  it("puts a created row first, unsaved", () => {
    const view = applyChange(listView({ active: [principal] }), {
      kind: "create",
      row: largo,
    });
    expect(view.active).toEqual([{ ...largo, unsaved: true }, principal]);
  });

  it("keeps the active list within its cap and notes the cut", () => {
    const full = listView({ active: rows(PAGE_ROW_LIMIT, "a") });
    const view = applyChange(full, { kind: "create", row: largo });
    expect(view.active).toHaveLength(PAGE_ROW_LIMIT);
    expect(view.active[0]).toEqual({ ...largo, unsaved: true });
    expect(view.activeTruncated).toBe(true);
  });

  it("replaces an updated row where it is", () => {
    const view = applyChange(listView({ active: [principal, largo, corto] }), {
      kind: "update",
      row: { id: "p2", name: "Mi cartera" },
    });
    expect(view.active).toEqual([
      principal,
      { id: "p2", name: "Mi cartera", unsaved: true },
      corto,
    ]);
  });

  it("moves an archived row to the top of the first archived page", () => {
    const view = applyChange(
      listView({ active: [principal, largo], archived: [corto] }),
      { kind: "archive", id: "p2" },
    );
    expect(view.active).toEqual([principal]);
    expect(view.archived).toEqual([{ ...largo, unsaved: true }, corto]);
  });

  it("keeps the first archived page within its cap", () => {
    const view = applyChange(
      listView({ active: [largo], archived: rows(ARCHIVED_ROW_LIMIT, "z") }),
      { kind: "archive", id: "p2" },
    );
    expect(view.archived).toHaveLength(ARCHIVED_ROW_LIMIT);
    expect(view.archived[0]).toEqual({ ...largo, unsaved: true });
  });

  it("leaves a later archived page as the server paged it", () => {
    const later = listView({
      active: [principal, largo],
      archived: [corto],
      archivedPage: "2026-10-09T00:00:00Z,p9",
      archivedFirstHref: "/accounts",
    });
    const view = applyChange(later, { kind: "archive", id: "p2" });
    expect(view.active).toEqual([principal]);
    expect(view.archived).toBe(later.archived);
  });

  it("moves a restored row, with its new name, to the top of the active rows", () => {
    const view = applyChange(
      listView({ active: [principal], archived: [largo, corto] }),
      { kind: "restore", row: { id: "p2", name: "Largo plazo 2" } },
    );
    expect(view.active).toEqual([
      { id: "p2", name: "Largo plazo 2", unsaved: true },
      principal,
    ]);
    expect(view.archived).toEqual([corto]);
  });

  it("notes no cut when a created row still fits", () => {
    const view = applyChange(
      listView({ active: rows(PAGE_ROW_LIMIT - 1, "a") }),
      { kind: "create", row: largo },
    );
    expect(view.active).toHaveLength(PAGE_ROW_LIMIT);
    expect(view.activeTruncated).toBe(false);
  });

  it("keeps a cut the server already noted", () => {
    const view = applyChange(
      listView({ active: [principal], activeTruncated: true }),
      { kind: "create", row: largo },
    );
    expect(view.activeTruncated).toBe(true);
  });

  it("keeps the active list within its cap on a restore", () => {
    const view = applyChange(
      listView({ active: rows(PAGE_ROW_LIMIT, "a"), archived: [largo] }),
      { kind: "restore", row: largo },
    );
    expect(view.active).toHaveLength(PAGE_ROW_LIMIT);
    expect(view.active[0]).toEqual({ ...largo, unsaved: true });
    expect(view.activeTruncated).toBe(true);
    expect(view.archived).toEqual([]);
  });

  it("drops a restored row from the archived ones when the active ones already show it", () => {
    const shown = listView({ active: [largo], archived: [largo, corto] });
    const view = applyChange(shown, { kind: "restore", row: largo });
    expect(view.active).toBe(shown.active);
    expect(view.archived).toEqual([corto]);
  });

  it("does not list an archived row twice", () => {
    const view = applyChange(
      listView({ active: [principal, largo], archived: [largo, corto] }),
      { kind: "archive", id: "p2" },
    );
    expect(view.active).toEqual([principal]);
    expect(view.archived).toEqual([largo, corto]);
  });

  it("changes nothing for a row the list does not show", () => {
    const shown = listView({ active: [largo], archived: [corto] });
    expect(applyChange(shown, { kind: "archive", id: "p1" })).toBe(shown);
    expect(applyChange(shown, { kind: "update", row: principal })).toBe(shown);
  });

  it("changes nothing when an archive or restore already shows", () => {
    const shown = listView({ active: [largo], archived: [corto] });
    expect(applyChange(shown, { kind: "archive", id: "p3" })).toBe(shown);
    expect(applyChange(shown, { kind: "restore", row: { ...largo } })).toBe(
      shown,
    );
    expect(applyChange(shown, { kind: "create", row: largo })).toBe(shown);
  });
});

describe("applySetupChange", () => {
  const account: SourceConnectionRow = {
    id: "c1",
    institution: "IOL",
    includeInTaxReport: true,
    portfolio: { ...largo, archived: false },
  };
  const lists: SetupLists = {
    sourceConnections: listView({ active: [account] }),
    portfolios: listView({ active: [principal, largo] }),
  };

  it("shows a portfolio's new name on the accounts that default to it", () => {
    const next = applySetupChange(lists, {
      list: "portfolios",
      change: { kind: "update", row: { id: "p2", name: "Retiro" } },
    });
    expect(next.sourceConnections.active[0]!.portfolio.name).toBe("Retiro");
  });

  it("shows a restored portfolio, active and with its name, on its archived accounts", () => {
    const archivedAccount: SourceConnectionRow = {
      ...account,
      id: "c2",
      portfolio: { id: "p3", name: "Corto plazo", archived: true },
    };
    const next = applySetupChange(
      {
        ...lists,
        sourceConnections: listView({
          active: [account],
          archived: [archivedAccount],
        }),
        portfolios: listView({ archived: [corto] }),
      },
      {
        list: "portfolios",
        change: { kind: "restore", row: { id: "p3", name: "Corto" } },
      },
    );
    expect(next.sourceConnections.archived[0]!.portfolio).toEqual({
      id: "p3",
      name: "Corto",
      archived: false,
    });
    expect(next.sourceConnections.active[0]).toBe(account);
  });

  it("changes nothing when no list shows the row", () => {
    expect(
      applySetupChange(lists, {
        list: "portfolios",
        change: { kind: "update", row: { id: "p9", name: "Nadie" } },
      }),
    ).toBe(lists);
  });

  it("keeps lists and accounts the change does not reach", () => {
    const next = applySetupChange(lists, {
      list: "portfolios",
      change: { kind: "update", row: { id: "p1", name: "Mía" } },
    });
    expect(next.sourceConnections).toBe(lists.sourceConnections);
  });

  it("renames a portfolio on its accounts when the portfolios shown leave it out", () => {
    const shown = { ...lists, portfolios: listView({ active: [principal] }) };
    const next = applySetupChange(shown, {
      list: "portfolios",
      change: { kind: "update", row: { id: "p2", name: "Retiro" } },
    });
    expect(next.sourceConnections.active[0]!.portfolio.name).toBe("Retiro");
    expect(next.portfolios).toBe(shown.portfolios);
  });

  it("keeps the archived accounts when a rename reaches only active ones", () => {
    const archived: SourceConnectionRow = {
      ...account,
      id: "c2",
      portfolio: { ...corto, archived: true },
    };
    const shown = {
      ...lists,
      sourceConnections: listView({ active: [account], archived: [archived] }),
    };
    const next = applySetupChange(shown, {
      list: "portfolios",
      change: { kind: "update", row: { id: "p2", name: "Retiro" } },
    });
    expect(next.sourceConnections.active[0]!.portfolio.name).toBe("Retiro");
    expect(next.sourceConnections.archived).toBe(
      shown.sourceConnections.archived,
    );
  });

  it("leaves the accounts as they are when a portfolio is created or archived", () => {
    const created = applySetupChange(lists, {
      list: "portfolios",
      change: { kind: "create", row: corto },
    });
    expect(created.portfolios.active[0]).toEqual({ ...corto, unsaved: true });
    expect(created.sourceConnections).toBe(lists.sourceConnections);
    const archived = applySetupChange(lists, {
      list: "portfolios",
      change: { kind: "archive", id: "p2" },
    });
    expect(archived.portfolios.active).toEqual([principal]);
    expect(archived.sourceConnections).toBe(lists.sourceConnections);
  });

  it("changes nothing when the accounts do not show the account", () => {
    expect(
      applySetupChange(lists, {
        list: "sourceConnections",
        change: { kind: "archive", id: "c9" },
      }),
    ).toBe(lists);
  });

  it("changes an account without touching the named lists", () => {
    const next = applySetupChange(lists, {
      list: "sourceConnections",
      change: { kind: "archive", id: "c1" },
    });
    expect(next.sourceConnections.active).toEqual([]);
    expect(next.portfolios).toBe(lists.portfolios);
  });
});

it("gives every created row its own id", () => {
  expect(temporaryId()).not.toBe(temporaryId());
});

it("never gives a created row an id the server could give", () => {
  expect(idSchema.safeParse(temporaryId()).success).toBe(false);
});
