import type { Metadata } from "next";

import { PrototypeImports } from "@/components/prototype/prototype-imports";
import { isProductionDeployment } from "@/lib/deployment";
import { navTitle } from "@/lib/navigation";

export const metadata: Metadata = { title: navTitle("/import") };

// Outside production it reads made-up statements.
export default function ImportPage() {
  if (!isProductionDeployment()) return <PrototypeImports />;
  return (
    <div>
      <h1 className="sr-only">{navTitle("/import")}</h1>
      <p className="text-sm text-muted-foreground">
        Acá vas a poder subir el resumen de tu broker.
      </p>
    </div>
  );
}
