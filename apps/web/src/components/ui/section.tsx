import type { LucideIcon } from "lucide-react";
import type * as React from "react";
import { useId } from "react";

import { cn } from "@/lib/utils";

// A block of a page, flat: a small heading with an optional icon and a short
// description, its actions on the same row, and the content below bringing
// its own surface (a table, a chart) when it has one.
function Section({
  title,
  icon: Icon,
  description,
  actions,
  className,
  children,
}: {
  title: React.ReactNode;
  icon?: LucideIcon;
  description?: React.ReactNode;
  // One primary button at most; the rest outline, as icons or in a menu.
  actions?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const id = useId();
  return (
    <section
      data-slot="section"
      aria-labelledby={id}
      className={cn("grid gap-3", className)}
    >
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="grid gap-0.5">
          <h2
            id={id}
            tabIndex={-1}
            className="flex items-center gap-2 text-sm font-semibold outline-none"
          >
            {Icon && (
              <Icon aria-hidden className="text-muted-foreground size-4" />
            )}
            {title}
          </h2>
          {description && (
            <p className="text-muted-foreground text-xs">{description}</p>
          )}
        </div>
        {actions && (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        )}
      </div>
      {children}
    </section>
  );
}

export { Section };
