"use client";

import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// A row action shown as an icon only. The tooltip names the action and the
// accessible name adds the row ("Archivar Principal").
function IconButton({
  icon: Icon,
  tooltip,
  label,
  onClick,
  pending = false,
  className,
}: {
  icon: LucideIcon;
  tooltip: string;
  label: string;
  onClick: () => void;
  // aria-disabled, not disabled: a disabled button drops its focus to the page.
  pending?: boolean;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={label}
          aria-disabled={pending}
          className={cn(
            "size-7 text-muted-foreground hover:text-foreground aria-disabled:opacity-50",
            className,
          )}
          onClick={() => {
            if (!pending) onClick();
          }}
        >
          <Icon className="size-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

export { IconButton };
