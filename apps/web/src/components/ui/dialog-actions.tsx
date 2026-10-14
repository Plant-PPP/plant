"use client";

import { ChevronRight } from "lucide-react";
import type * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { DialogClose, DialogFooter } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { PendingButton } from "@/components/ui/pending-button";
import { cn } from "@/lib/utils";

// A dialog's buttons, at the overlay scale.
const DIALOG_BUTTON = "h-8 text-xs";

// A form dialog's footer: Cancelar, which closes it, and the submit button,
// marked with Return since Enter in a field sends the form.
function DialogActions({
  submitLabel,
  pending = false,
  destructive = false,
  children,
}: {
  submitLabel: string;
  pending?: boolean;
  destructive?: boolean;
  // Further actions, before Cancelar (an edit's delete).
  children?: React.ReactNode;
}) {
  return (
    <DialogFooter>
      {children}
      <DialogClose asChild>
        <Button type="button" variant="outline" className={DIALOG_BUTTON}>
          Cancelar
        </Button>
      </DialogClose>
      <PendingButton
        type="submit"
        pending={pending}
        variant={destructive ? "destructive" : "default"}
        className={cn(DIALOG_BUTTON, "gap-2")}
      >
        {submitLabel}
        <Kbd
          aria-hidden
          className={cn(
            "h-4 min-w-4 text-[10px]",
            destructive
              ? "bg-white/20 text-white"
              : "bg-primary-foreground/15 text-primary-foreground",
          )}
        >
          ↵
        </Kbd>
      </PendingButton>
    </DialogFooter>
  );
}

// The fields a form needs only sometimes, folded under a line that names
// them, so the dialog opens with what it must have. Open from the start when
// any of them already holds something; once open, they read as more rows of
// the same form.
function MoreFields({
  label,
  defaultOpen = false,
  children,
}: {
  // What is inside, in a few words ("Cuota, tasa y vencimientos").
  label: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Collapsible defaultOpen={defaultOpen} className="grid gap-4">
      <CollapsibleTrigger className="group text-muted-foreground flex w-fit items-center gap-1 text-xs font-medium outline-none focus-visible:underline">
        <ChevronRight
          aria-hidden
          className="size-3.5 transition-transform group-data-[state=open]:rotate-90"
        />
        {label}
      </CollapsibleTrigger>
      <CollapsibleContent className="grid gap-4">{children}</CollapsibleContent>
    </Collapsible>
  );
}

export { DIALOG_BUTTON, DialogActions, MoreFields };
