import type * as React from "react";

import { cn } from "@/lib/utils";

const VARIANTS = {
  neutral: "border-transparent bg-secondary text-secondary-foreground",
  outline: "text-foreground",
  info: "border-transparent bg-primary/15 text-foreground",
  warning: "border-transparent bg-warn/15 text-foreground",
  success: "border-transparent bg-gain/15 text-foreground",
  error: "border-transparent bg-destructive/15 text-foreground",
} as const;

export type BadgeVariant = keyof typeof VARIANTS;

// A short status beside a name or a title ("En curso", "Parcial"). A status
// is a tinted pill whose text keeps the foreground, for contrast.
function Badge({
  variant = "neutral",
  className,
  ...props
}: React.ComponentProps<"span"> & { variant?: BadgeVariant }) {
  return (
    <span
      data-slot="badge"
      data-variant={variant}
      className={cn(
        "inline-flex w-fit shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap [&>svg]:size-3",
        VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}

export { Badge };
