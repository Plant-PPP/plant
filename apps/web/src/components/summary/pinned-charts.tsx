"use client";

import { PinOff } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { ChartBoundary, ChartCard } from "@/components/assistant/chart-card";
import { Button } from "@/components/ui/button";
import type { ChartPart } from "@/lib/assistant/chat";

// A chart pinned from the assistant, drawn again from today's data; null when
// it could not be (its portfolio is gone, or the data failed).
export type PinnedChart = { id: string; chart: ChartPart | null; asOf: string };

// The assistant's charts the user pinned, each drawn again, and the way to let
// one go; it leaves at once and comes back if the server refuses.
export function PinnedCharts({
  pinned,
  onUnpin,
}: {
  pinned: readonly PinnedChart[];
  onUnpin: (id: string) => Promise<boolean>;
}) {
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const [, startTransition] = useTransition();
  const shown = pinned.filter((each) => !gone.has(each.id));
  if (shown.length === 0) return null;

  function unpin(id: string) {
    setGone((current) => new Set(current).add(id));
    startTransition(async () => {
      const removed = await onUnpin(id).catch(() => false);
      if (removed) return;
      setGone((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
      toast.error("No pudimos soltar el gráfico. Probá de nuevo.");
    });
  }

  return (
    <section className="grid gap-3" aria-labelledby="pinned-charts">
      <h2 id="pinned-charts" className="text-base font-semibold">
        Gráficos fijados
      </h2>
      <div className="grid gap-3 lg:grid-cols-2">
        {shown.map((each) => (
          <div key={each.id} className="grid gap-1">
            {each.chart ? (
              <ChartBoundary>
                <ChartCard chart={each.chart} asOf={each.asOf} />
              </ChartBoundary>
            ) : (
              <p className="text-muted-foreground rounded-lg border p-3 text-xs">
                No pudimos dibujar este gráfico con tus datos de hoy.
              </p>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="justify-self-end"
              onClick={() => unpin(each.id)}
            >
              <PinOff />
              Soltar
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}
