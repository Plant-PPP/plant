"use client";

import type { LucideIcon } from "lucide-react";
import { PendingButton } from "@/components/ui/pending-button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// An action shown as an icon only. The tooltip names the action and the
// accessible name adds its object ("Archivar Principal"). A row's is ghost and
// small; a toolbar's sits beside the page's selects at their height.
function IconButton({
  icon: Icon,
  actionId,
  tooltip,
  label,
  onClick,
  pending = false,
  size = "row",
  className,
}: {
  icon: LucideIcon;
  // Rendered as `data-action`, so the button can be found again by its row.
  actionId?: string;
  tooltip: string;
  label: string;
  onClick: () => void;
  pending?: boolean;
  size?: "row" | "toolbar";
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <PendingButton
          variant={size === "row" ? "ghost" : "outline"}
          size="icon"
          aria-label={label}
          data-action={actionId}
          pending={pending}
          className={cn(
            size === "row"
              ? "size-7 text-muted-foreground hover:text-foreground"
              : "size-7",
            className,
          )}
          onClick={onClick}
        >
          <Icon className="size-3.5" />
        </PendingButton>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

export { IconButton };
