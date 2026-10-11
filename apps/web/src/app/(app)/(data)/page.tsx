import type { Metadata } from "next";

import { PrototypeSummary } from "@/components/prototype/prototype-summary";
import { isProductionDeployment } from "@/lib/deployment";
import { navTitle } from "@/lib/navigation";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: navTitle("/") };

// Outside production it shows the made-up net worth and closes.
export default async function Home({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
} = {}) {
  if (!isProductionDeployment()) {
    return <PrototypeSummary params={(await searchParams) ?? {}} />;
  }
  return (
    <div>
      <h1 className="sr-only">{navTitle("/")}</h1>
      <p className="text-sm text-muted-foreground">
        Acá vas a ver tu patrimonio en pesos y en dólares.
      </p>
    </div>
  );
}
