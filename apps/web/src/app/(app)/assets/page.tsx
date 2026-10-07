import type { Metadata } from "next";
import { navTitle } from "@/lib/navigation";

export const metadata: Metadata = { title: navTitle("/assets") };

export default function AssetsPage() {
  return (
    <div>
      <h1 className="sr-only">{navTitle("/assets")}</h1>
      <p className="text-sm text-muted-foreground">
        Todavía no cargaste activos.
      </p>
    </div>
  );
}
