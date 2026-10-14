"use client";

import { AccountsSetup } from "@/components/portfolio-setup/accounts-setup";
import { SCOPE_HREFS } from "@/lib/holdings/scope-hrefs";
import type { IconResult } from "@/lib/institutions/read-icon";
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

// `readIcon` is the real reading: an icon comes from the site, not the
// prototype.
export function PrototypeAccounts({
  readIcon,
}: {
  readIcon?: (site: string) => Promise<IconResult>;
}) {
  const { state, actions } = usePrototype();
  return (
    <AccountsSetup
      sourceConnections={view(state.accounts, state.archivedAccounts)}
      portfolios={view(state.portfolios, state.archivedPortfolios)}
      actions={{
        sourceConnections: { ...actions.sourceConnections, readIcon },
        portfolios: actions.portfolios,
      }}
      deletable={deletableRows(state)}
      hrefs={SCOPE_HREFS}
    />
  );
}
