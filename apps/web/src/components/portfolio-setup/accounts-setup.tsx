"use client";

import type {
  HoldersView,
  PortfoliosView,
  SourceConnectionsView,
} from "@/lib/portfolio-setup/read";
import { type AccountLink, accountsUsing } from "./accounts-using";
import { HoldersCard } from "./holders-card";
import { PortfoliosCard } from "./portfolios-card";
import { useSetupActions } from "./setup-actions";
import { SourceConnectionsCard } from "./source-connections-card";

// The accounts page's list sections, drawn from the lists as the user should
// see them while a write runs. An archive refused because active accounts use a
// portfolio or holder names those accounts, from the ones this page shows.
export function AccountsSetup({
  sourceConnections,
  portfolios,
  holders,
}: {
  sourceConnections: SourceConnectionsView;
  portfolios: PortfoliosView;
  holders: HoldersView;
}) {
  const { lists, pending, run } = useSetupActions({
    sourceConnections,
    portfolios,
    holders,
  });
  const usedBy = (key: AccountLink) => (id: string) =>
    accountsUsing(lists.sourceConnections.active, key, id);

  return (
    <div className="grid gap-10">
      <p role="status" className="sr-only">
        {pending ? "Guardando…" : ""}
      </p>
      <SourceConnectionsCard
        view={lists.sourceConnections}
        pending={pending}
        run={run}
        holders={lists.holders.active}
        portfolios={lists.portfolios.active}
      />
      <PortfoliosCard
        view={lists.portfolios}
        pending={pending}
        run={run}
        usedBy={usedBy("portfolio")}
      />
      <HoldersCard
        view={lists.holders}
        pending={pending}
        run={run}
        usedBy={usedBy("holder")}
      />
    </div>
  );
}
