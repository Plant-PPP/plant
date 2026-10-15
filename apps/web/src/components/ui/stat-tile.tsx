import type * as React from "react";

import { cn } from "@/lib/utils";

// A row of figure tiles: two across, four from `lg`.
function StatGrid({ className, ...props }: React.ComponentProps<"dl">) {
  return (
    <dl
      data-slot="stat-grid"
      className={cn("grid grid-cols-2 gap-2 lg:grid-cols-4", className)}
      {...props}
    />
  );
}

// One figure of a `StatGrid`: a muted label, the figure large, and a note
// (its share, its change) under it. Its lines stack from the top, so figures
// line up across a row whether or not their tiles carry a note.
function StatTile({
  label,
  note,
  className,
  children,
}: {
  label: string;
  note?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      data-slot="stat-tile"
      className={cn(
        "bg-card @container grid min-w-0 content-start gap-1.5 rounded-lg border px-4 py-3",
        className,
      )}
    >
      <dt className="text-muted-foreground text-sm font-medium">{label}</dt>
      {/* A figure is never cut: it steps down with the tile's width, and
          wraps as a last resort. */}
      <dd className="text-lg font-semibold tracking-tight break-words tabular-nums @[11rem]:text-xl @[15rem]:text-2xl">
        {children}
      </dd>
      {note !== undefined && (
        <dd className="text-muted-foreground text-xs tabular-nums">{note}</dd>
      )}
    </div>
  );
}

export { StatGrid, StatTile };
