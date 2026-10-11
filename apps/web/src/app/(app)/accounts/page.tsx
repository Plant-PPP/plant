import type { Metadata } from "next";
import {
  archiveHolder,
  archivePortfolio,
  archiveSourceConnection,
  createHolder,
  createPortfolio,
  createSourceConnection,
  renameHolder,
  renamePortfolio,
  restoreHolder,
  restorePortfolio,
  restoreSourceConnection,
  updateSourceConnection,
} from "@/app/(app)/accounts/actions";
import { AccountsSetup } from "@/components/portfolio-setup/accounts-setup";
import { PrototypeAccounts } from "@/components/prototype/prototype-accounts";
import { isProductionDeployment } from "@/lib/deployment";
import { getSessionClaims } from "@/lib/auth/session-claims";
import { navTitle } from "@/lib/navigation";
import {
  readHolders,
  readPortfolios,
  readSourceConnections,
} from "@/lib/portfolio-setup/read";
import { createClient } from "@/lib/supabase/server";
import { currentRequestId } from "@/lib/request-id-server";

export const metadata: Metadata = { title: navTitle("/accounts") };
export const dynamic = "force-dynamic";

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!isProductionDeployment()) {
    return (
      <div>
        <h1 className="sr-only">{navTitle("/accounts")}</h1>
        <PrototypeAccounts />
      </div>
    );
  }
  const claims = await getSessionClaims();
  const client = await createClient();
  const context = {
    userId: claims.sub,
    requestId: await currentRequestId(),
    page: "/accounts" as const,
    params: await searchParams,
  };
  const [sourceConnections, portfolios, holders] = await Promise.all([
    readSourceConnections(client, context),
    readPortfolios(client, context),
    readHolders(client, context),
  ]);
  return (
    <div>
      <h1 className="sr-only">{navTitle("/accounts")}</h1>
      <AccountsSetup
        sourceConnections={sourceConnections}
        portfolios={portfolios}
        holders={{
          view: holders,
          actions: {
            create: createHolder,
            rename: renameHolder,
            archive: archiveHolder,
            restore: restoreHolder,
          },
        }}
        actions={{
          sourceConnections: {
            create: createSourceConnection,
            update: updateSourceConnection,
            archive: archiveSourceConnection,
            restore: restoreSourceConnection,
          },
          portfolios: {
            create: createPortfolio,
            rename: renamePortfolio,
            archive: archivePortfolio,
            restore: restorePortfolio,
          },
        }}
      />
    </div>
  );
}
