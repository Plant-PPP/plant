import type * as React from "react";

import { cn } from "@/lib/utils";

// A page's first row: its filters on the left and its actions on the right,
// at the toolbar's scale. The breadcrumb names the page on screen, so the
// title is a heading for screen readers only.
function PageHeader({
  title,
  filters,
  actions,
  className,
}: {
  title: string;
  filters?: React.ReactNode;
  // One primary at most; the rest outline, or in a ⋮ menu.
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      data-slot="page-header"
      className={cn("flex min-h-7 flex-wrap items-center gap-2", className)}
    >
      <h1 className="sr-only">{title}</h1>
      {filters && (
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {filters}
        </div>
      )}
      {actions && (
        <div
          className="ml-auto flex shrink-0 items-center gap-2"
          data-print="hidden"
        >
          {actions}
        </div>
      )}
    </div>
  );
}

export { PageHeader };
