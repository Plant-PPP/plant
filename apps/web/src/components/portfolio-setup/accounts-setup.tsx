"use client";

import type {
  Deletable,
  PortfoliosView,
  SourceConnectionsView,
} from "@/lib/portfolio-setup/read";
import { type ScopeHrefs, scopeLink } from "@/lib/holdings/scope-hrefs";
import { accountsUsing } from "./accounts-using";
import { type PortfolioActions, PortfoliosCard } from "./portfolios-card";
import { useSetupActions } from "./setup-actions";
import {
  type SourceConnectionActions,
  SourceConnectionsCard,
} from "./source-connections-card";

// The accounts page's list sections, drawn from the lists as the user should
// see them while a write runs. An archive refused because active accounts use
// a portfolio names those accounts, from the ones this page shows.
export function AccountsSetup({
  sourceConnections,
  portfolios,
  actions,
  deletable,
  hrefs,
}: {
  sourceConnections: SourceConnectionsView;
  portfolios: PortfoliosView;
  actions: {
    sourceConnections: SourceConnectionActions;
    portfolios: PortfolioActions;
  };
  // The rows a delete would go through for, when the page deletes.
  deletable?: Deletable;
  hrefs?: ScopeHrefs;
}) {
  const { lists, pending, run } = useSetupActions({
    sourceConnections,
    portfolios,
  });
  const usedBy = (id: string) =>
    accountsUsing(lists.sourceConnections.active, id);

  return (
    <div className="grid gap-10">
      <p role="status" className="sr-only">
        {pending ? "Guardando…" : ""}
      </p>
      <SourceConnectionsCard
        view={lists.sourceConnections}
        pending={pending}
        run={run}
        portfolios={lists.portfolios.active}
        actions={actions.sourceConnections}
        deletable={deletable?.sourceConnections}
        deletesUploads={deletable?.deletesUploads}
        href={scopeLink(hrefs, "account")}
      />
      <PortfoliosCard
        view={lists.portfolios}
        pending={pending}
        run={run}
        usedBy={usedBy}
        actions={actions.portfolios}
        deletable={deletable?.portfolios}
        href={scopeLink(hrefs, "portfolio")}
      />
    </div>
  );
}
