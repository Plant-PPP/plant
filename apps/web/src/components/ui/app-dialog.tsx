"use client";

import type * as React from "react";
import { useRef, useState } from "react";
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
  className,
  children,
}: {
  onClose: () => void;
  title: string;
  description: string;
  // Where focus goes on close, given the element that opened the dialog when
  // it is still on the page.
  returnFocusTo?: (opener: HTMLElement | null) => HTMLElement | null;
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
  const content = useRef<HTMLDivElement>(null);
  useSubmitWhenValid(content);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        ref={content}
        data-slot="app-dialog"
        className={cn(
          "max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md",
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
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

export { AppDialog };
