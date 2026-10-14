"use client";

import { BellRing } from "lucide-react";
import Link from "next/link";
import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { alertLine, type PriceAlert } from "@/lib/alerts/alerts";

// The price alerts the quotes met and the user has not seen yet; each leaves
// at once when marked seen and comes back if the server refuses.
export function MetAlerts({
  alerts,
  onSeen,
}: {
  alerts: readonly PriceAlert[];
  onSeen: (id: string) => Promise<boolean>;
}) {
  const [shown, hide] = useOptimistic(
    alerts,
    (current: readonly PriceAlert[], id: string) =>
      current.filter((each) => each.id !== id),
  );
  const [, startTransition] = useTransition();
  if (shown.length === 0) return null;

  return (
    <section
      aria-labelledby="met-alerts"
      className="grid gap-2 rounded-lg border p-3"
      data-print="hidden"
    >
      <h2
        id="met-alerts"
        className="flex items-center gap-2 text-sm font-semibold"
      >
        <BellRing className="size-4" />
        Tus alertas de precio
      </h2>
      <ul className="grid gap-1">
        {shown.map((alert) => (
          <li
            key={alert.id}
            className="flex flex-wrap items-center justify-between gap-2 text-sm"
          >
            <span>{alertLine(alert)}</span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() =>
                startTransition(async () => {
                  hide(alert.id);
                  if (!(await onSeen(alert.id).catch(() => false))) {
                    toast.error("No pudimos marcar el aviso. Probá de nuevo.");
                  }
                })
              }
            >
              Listo
            </Button>
          </li>
        ))}
      </ul>
      <Link
        href="/settings"
        className="text-muted-foreground justify-self-start text-xs underline-offset-4 hover:underline"
      >
        Ver o crear alertas en Ajustes
      </Link>
    </section>
  );
}
