import type * as React from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// The toolbar's scale, for a button that is not a PageButton (a
// PendingButton).
export const PAGE_BUTTON_CLASS =
  "h-7 min-w-0 gap-1.5 px-2.5 text-xs has-[>svg]:px-2 [&_svg:not([class*='size-'])]:size-3.5";

// A page-level action, at the toolbar's fixed scale (28px, text-xs, 14px
// icons). Outline unless it is the page's one primary action. Dialogs and
// sheets keep the regular Button.
function PageButton({
  variant = "outline",
  className,
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <Button
      variant={variant}
      data-slot="page-button"
      className={cn(PAGE_BUTTON_CLASS, className)}
      {...props}
    />
  );
}

export { PageButton };
