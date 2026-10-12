import type { Metadata } from "next";

import { PrototypeChat } from "@/components/prototype/prototype-chat";
import { isProductionDeployment } from "@/lib/deployment";
import { navTitle } from "@/lib/navigation";

export const metadata: Metadata = { title: navTitle("/assistant") };

// Outside production it answers from the made-up data.
export default function AssistantPage() {
  if (!isProductionDeployment()) return <PrototypeChat />;
  return (
    <div>
      <h1 className="sr-only">{navTitle("/assistant")}</h1>
      <p className="text-sm text-muted-foreground">
        Acá vas a poder preguntarle a Plant sobre tu patrimonio.
      </p>
    </div>
  );
}
