import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PrototypeClose } from "@/components/prototype/prototype-summary";
import { isProductionDeployment } from "@/lib/deployment";
import { navTitle } from "@/lib/navigation";

export const metadata: Metadata = { title: navTitle("/") };

// A month's (2026-09) or a year's (2026) close. Closes come from movements,
// which only the made-up data has so far, so production has no such page yet.
export default async function ClosePage({
  params,
  searchParams,
}: {
  params: Promise<{ period: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (isProductionDeployment()) notFound();
  const { period } = await params;
  return <PrototypeClose period={period} params={await searchParams} />;
}
