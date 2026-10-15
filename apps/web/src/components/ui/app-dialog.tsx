"use client";

import type { LucideIcon } from "lucide-react";
import type * as React from "react";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSubmitWhenValid } from "@/components/ui/use-submit-when-valid";
import { cn } from "@/lib/utils";

// A form's dialog, open while mounted: a caller mounts it to open it. Its
// form sends only once complete (see useSubmitWhenValid).
function AppDialog({
  onClose,
  title,
  description,
  returnFocusTo,
  icon: Icon,
  className,
  children,
}: {
  onClose: () => void;
  title: string;
  description: string;
  // Where focus goes on close, given the element that opened the dialog when
  // it is still on the page.
  returnFocusTo?: (opener: HTMLElement | null) => HTMLElement | null;
  // Shown before the title, naming what the dialog is about.
  icon?: LucideIcon;
  // Classes over the default width, for content wider than a form.
  className?: string;
  children: React.ReactNode;
}) {
  // Opened by state with no DialogTrigger, so Radix has no trigger to return
  // focus to: keep whatever had focus when the dialog first rendered, before
  // its own autofocus moves it.
  const [opener] = useState(() =>
    typeof document === "undefined" ? null : document.activeElement,
  );
  const [content, setContent] = useState<HTMLDivElement | null>(null);
  useSubmitWhenValid(content);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        ref={setContent}
        data-slot="app-dialog"
        className={cn(
          // The overlay scale: labels and fields at text-xs from md, where a
          // phone's 16px input font (which stops iOS zooming in) is not needed.
          "max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md [&_[data-slot=label]]:text-xs [&_[data-slot=select-trigger]]:text-xs md:[&_input]:text-xs md:[&_textarea]:text-xs",
          className,
        )}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          // A click does not focus a button in Safari or Firefox on macOS,
          // so the opener can be the page itself.
          const present =
            opener instanceof HTMLElement &&
            opener !== document.body &&
            opener.isConnected
              ? opener
              : null;
          const target = returnFocusTo ? returnFocusTo(present) : present;
          if (target?.isConnected) target.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            {Icon && <Icon aria-hidden className="size-4" />}
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

export { AppDialog };
