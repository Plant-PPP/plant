import type { Metadata } from "next";
import { headers } from "next/headers";
import { PortfoliosCard } from "@/components/portfolio-setup/portfolios-card";
import { getSessionClaims } from "@/lib/auth/session-claims";
import { navTitle } from "@/lib/navigation";
import { readPortfolios } from "@/lib/portfolio-setup/read";
import { REQUEST_ID_HEADER, requestIdFrom } from "@/lib/request-id";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: navTitle("/accounts") };
export const dynamic = "force-dynamic";

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const claims = await getSessionClaims();
  const view = await readPortfolios(await createClient(), {
    userId: claims.sub,
    requestId: requestIdFrom((await headers()).get(REQUEST_ID_HEADER)),
    params: await searchParams,
  });
  return (
    <div>
      <h1 className="sr-only">{navTitle("/accounts")}</h1>
      <PortfoliosCard view={view} />
    </div>
  );
}
