import type { Metadata } from "next";
import { AccountsSetup } from "@/components/portfolio-setup/accounts-setup";
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
  const claims = await getSessionClaims();
  const client = await createClient();
  const context = {
    userId: claims.sub,
    requestId: await currentRequestId(),
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
        holders={holders}
      />
    </div>
  );
}
