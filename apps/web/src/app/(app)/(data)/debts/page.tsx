import type { Metadata } from "next";
import { navTitle } from "@/lib/navigation";

export const metadata: Metadata = { title: navTitle("/debts") };

export default function DebtsPage() {
  return (
    <div>
      <h1 className="sr-only">{navTitle("/debts")}</h1>
      <p className="text-sm text-muted-foreground">
        Todavía no cargaste deudas.
      </p>
    </div>
  );
}
