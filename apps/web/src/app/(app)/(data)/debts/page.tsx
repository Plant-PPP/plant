import type { Metadata } from "next";

import { PrototypeDebts } from "@/components/prototype/prototype-debts";
import { isProductionDeployment } from "@/lib/deployment";
import { navTitle } from "@/lib/navigation";

export const metadata: Metadata = { title: navTitle("/debts") };

// Outside production it shows made-up debts.
export default async function DebtsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
} = {}) {
  if (!isProductionDeployment()) {
    return <PrototypeDebts params={(await searchParams) ?? {}} />;
  }
  return (
    <div>
      <h1 className="sr-only">{navTitle("/debts")}</h1>
      <p className="text-sm text-muted-foreground">
        Todavía no cargaste deudas.
      </p>
    </div>
  );
}
