import type { Metadata } from "next";

import { SummaryView } from "@/app/(app)/(data)/summary-view";
import { PrototypeSummary } from "@/components/prototype/prototype-summary";
import { isProductionDeployment } from "@/lib/deployment";
import { navTitle } from "@/lib/navigation";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: navTitle("/") };

// The net worth, how it is split and its closes. Outside production it shows
// made-up data.
export default async function Home({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
} = {}) {
  const params = (await searchParams) ?? {};
  if (!isProductionDeployment()) {
    return <PrototypeSummary params={params} />;
  }
  return <SummaryView params={params} />;
}
