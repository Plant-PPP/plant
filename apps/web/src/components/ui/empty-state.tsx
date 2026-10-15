import type { LucideIcon } from "lucide-react";
import type * as React from "react";

import { cn } from "@/lib/utils";

// What stands where a page, a list or a chart has nothing to show yet: an
// icon in a muted square, a short title, one or two sentences on what goes
// here and how to start, and the actions that start it (the primary last).
function EmptyState({
  icon: Icon,
  title,
  actions,
  className,
  children,
}: {
  icon: LucideIcon;
  title: string;
  actions?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "flex flex-col items-center justify-center gap-6 rounded-lg border border-dashed p-6 text-center text-balance md:p-12",
        className,
      )}
    >
      <div className="flex max-w-sm flex-col items-center gap-2">
        <div className="bg-muted text-foreground mb-2 flex size-10 items-center justify-center rounded-lg">
          <Icon aria-hidden className="size-6" />
        </div>
        <p className="text-lg font-medium tracking-tight">{title}</p>
        {children && (
          <p className="text-muted-foreground text-sm/relaxed">{children}</p>
        )}
      </div>
      {actions && (
        <div className="flex max-w-sm flex-wrap justify-center gap-2">
          {actions}
        </div>
      )}
    </div>
  );
}

export { EmptyState };
