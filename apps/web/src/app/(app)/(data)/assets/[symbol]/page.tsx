import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PrototypeInstrument } from "@/components/prototype/prototype-instrument";
import { isProductionDeployment } from "@/lib/deployment";
import { navTitle } from "@/lib/navigation";

export const metadata: Metadata = { title: navTitle("/assets") };

// One instrument's history across every account and portfolio. It reads
// movements, which only the made-up data has so far, so production has no
// such page yet.
export default async function InstrumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ symbol: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (isProductionDeployment()) notFound();
  const { symbol } = await params;
  return (
    <PrototypeInstrument
      symbol={symbol.toUpperCase()}
      params={await searchParams}
    />
  );
}
