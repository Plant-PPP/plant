"use client";

import type * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// A button that stays focusable while its action runs: aria-disabled, not
// disabled, since a disabled button drops its focus to the page. The caller
// ignores clicks and submits while pending.
export function PendingButton({
  pending,
  className,
  ...props
}: { pending: boolean } & React.ComponentProps<typeof Button>) {
  return (
    <Button
      aria-disabled={pending}
      className={cn("aria-disabled:opacity-50", className)}
      {...props}
    />
  );
}
