import type { Metadata } from "next";

import { ScopeView } from "@/app/(app)/(data)/accounts/scope-view";
import { PrototypeScope } from "@/components/prototype/prototype-scope";
import { isProductionDeployment } from "@/lib/deployment";
import { navTitle } from "@/lib/navigation";

export const metadata: Metadata = { title: navTitle("/accounts") };
export const dynamic = "force-dynamic";

// One portfolio's holdings and movements. Outside production it shows made-up
// data.
export default async function PortfolioPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  if (!isProductionDeployment()) {
    return <PrototypeScope kind="portfolio" id={id} params={query} />;
  }
  return <ScopeView kind="portfolio" id={id} params={query} />;
}
