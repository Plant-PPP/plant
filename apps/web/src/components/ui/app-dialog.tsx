"use client";

import type * as React from "react";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// A form's dialog, open while mounted: a caller mounts it to open it.
function AppDialog({
  onOpenChange,
  title,
  description,
  returnFocusTo,
  children,
}: {
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  // Where focus goes on close, given the element that opened the dialog when
  // it is still on the page.
  returnFocusTo?: (opener: HTMLElement | null) => HTMLElement | null;
  children: React.ReactNode;
}) {
  // Opened by state with no DialogTrigger, so Radix has no trigger to return
  // focus to: keep whatever had focus when the dialog first rendered, before
  // its own autofocus moves it.
  const [opener] = useState(() =>
    typeof document === "undefined" ? null : document.activeElement,
  );

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        data-slot="app-dialog"
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md"
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
