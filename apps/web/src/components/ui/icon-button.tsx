"use client";

import type { LucideIcon } from "lucide-react";
import { PendingButton } from "@/components/ui/pending-button";
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
  actionId,
  tooltip,
  label,
  onClick,
  pending = false,
  className,
}: {
  icon: LucideIcon;
  // Rendered as `data-action`, so the button can be found again by its row.
  actionId?: string;
  tooltip: string;
  label: string;
  onClick: () => void;
  pending?: boolean;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <PendingButton
          variant="ghost"
          size="icon"
          aria-label={label}
          data-action={actionId}
          pending={pending}
          className={cn(
            "size-7 text-muted-foreground hover:text-foreground",
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
