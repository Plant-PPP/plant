"use client";

import type * as React from "react";
import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

// Open while mounted: a caller mounts it to open it.
function AppSheet({
  onOpenChange,
  title,
  description,
  returnFocusTo,
  children,
}: {
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  // Where focus goes on close instead of the element that opened the sheet,
  // when it returns one.
  returnFocusTo?: () => HTMLElement | null;
  children: React.ReactNode;
}) {
  // Opened by state rather than a SheetTrigger, so Radix has no trigger to
  // return focus to: keep whatever had focus when the sheet first rendered,
  // before its own autofocus moves it.
  const [opener] = useState(() =>
    typeof document === "undefined" ? null : document.activeElement,
  );

  return (
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent
        data-slot="app-sheet"
        className="w-full gap-0 sm:max-w-md"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const target = returnFocusTo?.() ?? opener;
          if (target instanceof HTMLElement && target.isConnected) {
            target.focus();
          }
        }}
      >
        <SheetHeader className="border-b pr-10">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-1 flex-col overflow-y-auto">{children}</div>
      </SheetContent>
    </Sheet>
  );
}

export { AppSheet };
