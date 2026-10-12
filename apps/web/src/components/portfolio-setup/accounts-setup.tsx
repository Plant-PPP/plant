"use client";

import type {
  HoldersView,
  PortfoliosView,
  SourceConnectionsView,
} from "@/lib/portfolio-setup/read";
import { type AccountLink, accountsUsing } from "./accounts-using";
import { HoldersCard } from "./holders-card";
import type { NamedRowsActions } from "./named-rows-card";
import { PortfoliosCard } from "./portfolios-card";
import { useSetupActions } from "./setup-actions";
import {
  type SourceConnectionActions,
  SourceConnectionsCard,
} from "./source-connections-card";

// The holders a page lists and what it writes them with; a page without them
// shows no holders anywhere.
export type HoldersSection = { view: HoldersView; actions: NamedRowsActions };

const NO_HOLDERS: HoldersView = {
  active: [],
  activeTruncated: false,
  archived: [],
  archivedPage: null,
  archivedFirstHref: null,
  archivedNextHref: null,
};

// The accounts page's list sections, drawn from the lists as the user should
// see them while a write runs. An archive refused because active accounts use a
// portfolio or holder names those accounts, from the ones this page shows.
export function AccountsSetup({
  sourceConnections,
  portfolios,
  holders,
  actions,
  deletesUploads,
}: {
  sourceConnections: SourceConnectionsView;
  portfolios: PortfoliosView;
  holders?: HoldersSection;
  actions: {
    sourceConnections: SourceConnectionActions;
    portfolios: NamedRowsActions;
  };
  deletesUploads?: readonly string[];
}) {
  const { lists, pending, run } = useSetupActions({
    sourceConnections,
    portfolios,
    holders: holders?.view ?? NO_HOLDERS,
  });
  const usedBy = (key: AccountLink) => (id: string) =>
    accountsUsing(lists.sourceConnections.active, key, id);
  const createHolder = holders?.actions.create;

  return (
    <div className="grid gap-10">
      <p role="status" className="sr-only">
        {pending ? "Guardando…" : ""}
      </p>
      <SourceConnectionsCard
        view={lists.sourceConnections}
        pending={pending}
        run={run}
        holders={
          createHolder && {
            rows: lists.holders.active,
            create: createHolder,
          }
        }
        portfolios={lists.portfolios.active}
        actions={actions.sourceConnections}
        deletesUploads={deletesUploads}
      />
      <PortfoliosCard
        view={lists.portfolios}
        pending={pending}
        run={run}
        usedBy={usedBy("portfolio")}
        actions={actions.portfolios}
      />
      {holders && (
        <HoldersCard
          view={lists.holders}
          pending={pending}
          run={run}
          usedBy={usedBy("holder")}
          actions={holders.actions}
        />
      )}
    </div>
  );
}
