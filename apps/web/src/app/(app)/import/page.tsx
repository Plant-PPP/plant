import type { Metadata } from "next";
import { navTitle } from "@/lib/navigation";

export const metadata: Metadata = { title: navTitle("/import") };

export default function ImportPage() {
  return (
    <div>
      <h1 className="sr-only">{navTitle("/import")}</h1>
      <p className="text-sm text-muted-foreground">
        Acá vas a poder subir el resumen de tu broker.
      </p>
    </div>
  );
}
