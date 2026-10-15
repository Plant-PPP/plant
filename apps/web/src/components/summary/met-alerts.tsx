"use client";

import { BellRing, Check } from "lucide-react";
import Link from "next/link";
import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Notice } from "@/components/ui/notice";
import { alertLine, type PriceAlert } from "@/lib/alerts/alerts";
import { settle } from "@/lib/server-action-call";

// The price alerts the quotes met and the user has not seen yet; each leaves
// at once when marked seen and comes back if the server refuses.
export function MetAlerts({
  alerts,
  readFailed = false,
  onSeen,
}: {
  alerts: readonly PriceAlert[];
  readFailed?: boolean;
  onSeen: (id: string) => Promise<boolean>;
}) {
  const [shown, hide] = useOptimistic(
    alerts,
    (current: readonly PriceAlert[], id: string) =>
      current.filter((each) => each.id !== id),
  );
  const [, startTransition] = useTransition();

  if (readFailed) {
    return (
      <Notice variant="error" data-print="hidden">
        No pudimos leer tus alertas de precio. Recargá la página para verlas.
      </Notice>
    );
  }
  if (shown.length === 0) return null;

  return (
    <Notice
      icon={BellRing}
      title="Tus alertas de precio"
      data-print="hidden"
      action={
        <Button asChild variant="link" size="sm" className="h-auto px-0">
          <Link href="/settings">Ver o crear alertas</Link>
        </Button>
      }
    >
      <ul className="grid gap-0.5">
        {shown.map((alert) => (
          <li
            key={alert.id}
            className="text-foreground flex items-center justify-between gap-2"
          >
            <span>{alertLine(alert)}</span>
            <IconButton
              icon={Check}
              tooltip="Marcar como visto"
              label={`Listo: ${alertLine(alert)}`}
              onClick={() =>
                startTransition(async () => {
                  hide(alert.id);
                  if ((await settle(onSeen(alert.id))) !== true) {
                    toast.error("No pudimos marcar el aviso. Probá de nuevo.");
                  }
                })
              }
            />
          </li>
        ))}
      </ul>
    </Notice>
  );
}
