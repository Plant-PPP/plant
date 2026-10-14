import type * as React from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
      className={cn(
        "h-7 min-w-0 gap-1.5 px-2.5 text-xs has-[>svg]:px-2 [&_svg:not([class*='size-'])]:size-3.5",
        className,
      )}
      {...props}
    />
  );
}

export { PageButton };
