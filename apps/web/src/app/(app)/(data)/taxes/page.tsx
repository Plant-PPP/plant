import type { Metadata } from "next";

import { PrototypeTaxes } from "@/components/prototype/prototype-taxes";
import { isProductionDeployment } from "@/lib/deployment";
import { navTitle } from "@/lib/navigation";

import { TaxesView } from "./taxes-view";

export const metadata: Metadata = { title: navTitle("/taxes") };
export const dynamic = "force-dynamic";

// A year's estimate for Bienes Personales and Ganancias (?year=, else the
// last year that ended). Outside production it shows made-up data.
export default async function TaxesRoute({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
} = {}) {
  const params = (await searchParams) ?? {};
  if (!isProductionDeployment()) {
    return <PrototypeTaxes params={params} />;
  }
  return <TaxesView params={params} />;
}
