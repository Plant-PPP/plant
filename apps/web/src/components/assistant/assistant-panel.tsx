"use client";

import { Bot, X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";

// A page with the assistant beside it: on a wide screen the chat opens as a
// column that pushes the page aside, on a phone as a sheet over it.
export function AssistantPanel({
  chat,
  children,
}: {
  chat: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const mobile = useIsMobile();
  const toggle = useRef<HTMLButtonElement>(null);
  const close = useRef<HTMLButtonElement>(null);

  // Focus goes into the column as it opens and back to the button as it
  // closes, which only shows again once it has.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !mobile) close.current?.focus();
    if (!open && wasOpen.current) toggle.current?.focus();
    wasOpen.current = open;
  }, [open, mobile]);

  return (
    <div className="flex items-start gap-4">
      <div className="grid min-w-0 flex-1 gap-4">{children}</div>
      {open && !mobile && (
        <aside
          aria-label="Asistente"
          className="bg-background sticky top-20 flex h-[calc(100svh-7rem)] w-[400px] shrink-0 flex-col gap-2 rounded-xl border p-3"
        >
          <Button
            ref={close}
            type="button"
            size="icon"
            variant="ghost"
            aria-label="Cerrar el asistente"
            className="size-7 self-end"
            onClick={() => setOpen(false)}
          >
            <X />
          </Button>
          <div className="min-h-0 flex-1 overflow-y-auto">{chat}</div>
        </aside>
      )}
      {mobile && (
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent className="w-full p-4 pt-10 sm:max-w-md">
            <SheetTitle className="sr-only">Asistente</SheetTitle>
            <SheetDescription className="sr-only">
              Preguntale a Plant sobre lo que estás viendo.
            </SheetDescription>
            <div className="min-h-0 flex-1 overflow-y-auto">{chat}</div>
          </SheetContent>
        </Sheet>
      )}
      {!(open && !mobile) && (
        <Button
          ref={toggle}
          type="button"
          aria-expanded={open}
          className="fixed right-4 bottom-4 z-30 rounded-full shadow-lg"
          onClick={() => setOpen(true)}
        >
          <Bot />
          Preguntale a Plant
        </Button>
      )}
    </div>
  );
}
