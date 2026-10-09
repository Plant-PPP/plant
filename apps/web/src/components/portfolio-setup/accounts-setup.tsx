"use client";

import type {
  HoldersView,
  PortfoliosView,
  SourceConnectionsView,
} from "@/lib/portfolio-setup/read";
import { HoldersCard } from "./holders-card";
import { PortfoliosCard } from "./portfolios-card";
import { SourceConnectionsCard } from "./source-connections-card";

// The accounts page's cards. An archive refused because active accounts use a
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
  const usedBy =
    (key: "portfolio" | "holder") =>
    (id: string): string[] =>
      sourceConnections.active
        .filter((row) => row[key]?.id === id)
        .map((row) => row.institution);

  return (
    <div className="grid gap-6">
      <SourceConnectionsCard
        view={sourceConnections}
        holders={holders.active}
        portfolios={portfolios.active}
      />
      <PortfoliosCard view={portfolios} usedBy={usedBy("portfolio")} />
      <HoldersCard view={holders} usedBy={usedBy("holder")} />
    </div>
  );
}
