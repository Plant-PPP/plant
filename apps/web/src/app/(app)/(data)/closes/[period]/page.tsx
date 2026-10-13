import type { Metadata } from "next";

import { CloseView } from "@/app/(app)/(data)/summary-view";
import { PrototypeClose } from "@/components/prototype/prototype-summary";
import { isProductionDeployment } from "@/lib/deployment";
import { navTitle } from "@/lib/navigation";

export const metadata: Metadata = { title: navTitle("/") };
export const dynamic = "force-dynamic";

// A month's (2026-09) or a year's (2026) close. Outside production it shows
// made-up data.
export default async function ClosePage({
  params,
  searchParams,
}: {
  params: Promise<{ period: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { period } = await params;
  const query = await searchParams;
  if (!isProductionDeployment()) {
    return <PrototypeClose period={period} params={query} />;
  }
  return <CloseView period={period} params={query} />;
}
