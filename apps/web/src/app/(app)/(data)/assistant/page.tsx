import type { Metadata } from "next";
import { navTitle } from "@/lib/navigation";

export const metadata: Metadata = { title: navTitle("/assistant") };

export default function AssistantPage() {
  return (
    <div>
      <h1 className="sr-only">{navTitle("/assistant")}</h1>
      <p className="text-sm text-muted-foreground">
        Acá vas a poder preguntarle a Plant sobre tu patrimonio.
      </p>
    </div>
  );
}
