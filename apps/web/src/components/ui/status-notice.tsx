import type * as React from "react";

import { cn } from "@/lib/utils";

// Always mounted, so a screen reader is already watching the region when the
// text arrives; a live region inserted with its text is often not announced.
function StatusNotice({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <p
      data-slot="status-notice"
      role="status"
      className={
        children ? cn("text-sm text-muted-foreground", className) : "sr-only"
      }
    >
      {children}
    </p>
  );
}

export { StatusNotice };
