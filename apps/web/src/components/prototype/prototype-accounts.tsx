"use client";

import { AccountsSetup } from "@/components/portfolio-setup/accounts-setup";
import type { ListView } from "@/lib/portfolio-setup/read";

import { deletableRows } from "./prototype-accounts-store";
import { usePrototype } from "./prototype-provider";

const view = <Row,>(active: Row[], archived: Row[]): ListView<Row> => ({
  active,
  activeTruncated: false,
  archived,
  archivedPage: null,
  archivedFirstHref: null,
  archivedNextHref: null,
});

export function PrototypeAccounts() {
  const { state, actions } = usePrototype();
  return (
    <AccountsSetup
      sourceConnections={view(state.accounts, state.archivedAccounts)}
      portfolios={view(state.portfolios, state.archivedPortfolios)}
      actions={{
        sourceConnections: actions.sourceConnections,
        portfolios: actions.portfolios,
      }}
      deletable={deletableRows(state)}
    />
  );
}
