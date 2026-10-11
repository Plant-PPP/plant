import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PrototypeScope } from "@/components/prototype/prototype-scope";
import { isProductionDeployment } from "@/lib/deployment";
import { navTitle } from "@/lib/navigation";

export const metadata: Metadata = { title: navTitle("/accounts") };

// One portfolio's holdings and movements. Movements exist only in the made-up
// data so far, so production has no such page yet.
export default async function PortfolioPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (isProductionDeployment()) notFound();
  const { id } = await params;
  return (
    <PrototypeScope kind="portfolio" id={id} params={await searchParams} />
  );
}
