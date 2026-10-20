"use client";

import { ChartNoAxesColumn, Pin, PinOff } from "lucide-react";
import { use, useState, useTransition } from "react";
import { toast } from "sonner";

import { ChartBoundary, ChartCard } from "@/components/assistant/chart-card";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/icon-button";
import { Section } from "@/components/ui/section";
import type { ChartPart } from "@/lib/assistant/chat";
import { settle } from "@/lib/server-action-call";

// A chart pinned from the assistant, drawn again from today's data; null when
// it could not be (its portfolio is gone, or the data failed).
export type PinnedChart = { id: string; chart: ChartPart | null; asOf: string };

// The assistant's charts the user pinned, each drawn again, and the way to let
// one go; it leaves at once and comes back if the server refuses. The server
// hands them over still drawing, so they stream in after the page.
export function PinnedCharts({
  pinned,
  onUnpin,
}: {
  pinned: readonly PinnedChart[] | Promise<readonly PinnedChart[]>;
  onUnpin: (id: string) => Promise<boolean>;
}) {
  const drawn = pinned instanceof Promise ? use(pinned) : pinned;
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const [, startTransition] = useTransition();
  const shown = drawn.filter((each) => !gone.has(each.id));
  if (shown.length === 0) return null;

  function unpin(id: string) {
    setGone((current) => new Set(current).add(id));
    startTransition(async () => {
      if ((await settle(onUnpin(id))) === true) return;
      setGone((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
      toast.error("No pudimos soltar el gráfico. Probá de nuevo.");
    });
  }

  return (
    <Section
      title="Gráficos fijados"
      icon={Pin}
      description="Los que fijaste desde el asistente, con tus datos de hoy"
    >
      <div className="grid gap-4 lg:grid-cols-2">
        {shown.map((each) => {
          const unpinButton = (
            <IconButton
              icon={PinOff}
              tooltip="Soltar"
              label={`Soltar: ${each.chart?.title ?? "gráfico"}`}
              onClick={() => unpin(each.id)}
            />
          );
          return each.chart ? (
            <ChartBoundary key={each.id}>
              <ChartCard
                chart={each.chart}
                asOf={each.asOf}
                actions={unpinButton}
              />
            </ChartBoundary>
          ) : (
            <EmptyState
              key={each.id}
              icon={ChartNoAxesColumn}
              title="No pudimos dibujar este gráfico"
              actions={unpinButton}
            >
              Sus datos de hoy no alcanzan para armarlo, o su cartera ya no
              está.
            </EmptyState>
          );
        })}
      </div>
    </Section>
  );
}
