"use client";

import type * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// A button that stays focusable while its action runs: aria-disabled, not
// disabled, since a disabled button drops its focus to the page. While
// pending it ignores clicks, a submit button included.
function PendingButton({
  pending,
  className,
  onClick,
  ...props
}: { pending: boolean } & React.ComponentProps<typeof Button>) {
  return (
    <Button
      aria-disabled={pending}
      className={cn("aria-disabled:opacity-50", className)}
      onClick={(event) => {
        if (pending) event.preventDefault();
        else onClick?.(event);
      }}
      {...props}
    />
  );
}

export { PendingButton };
