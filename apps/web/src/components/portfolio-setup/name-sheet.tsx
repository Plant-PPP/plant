"use client";

import { useRef } from "react";
import { AppSheet } from "@/components/ui/app-sheet";
import { Button } from "@/components/ui/button";
import { SheetFooter } from "@/components/ui/sheet";
import type { WriteResult } from "@/lib/portfolio-setup/write-result";
import type { WriteMessages } from "./answers";
import { NameField, useNameSubmit } from "./name-field";

// A sheet that asks for one name and saves it with `onSubmit`: creating,
// renaming, or restoring under a new name.
export function NameSheet({
  onClose,
  title,
  description,
  submitLabel,
  defaultValue = "",
  returnFocusTo,
  savedRemovesOpener = false,
  messages,
  onSubmit,
  onSaved,
}: {
  onClose: () => void;
  title: string;
  description: string;
  submitLabel: string;
  defaultValue?: string;
  // Where focus goes when the opener is gone, and after a save that removes
  // it (savedRemovesOpener): the save's refresh may land after the close.
  returnFocusTo: () => HTMLElement | null;
  savedRemovesOpener?: boolean;
  messages: WriteMessages;
  onSubmit: (name: string) => Promise<WriteResult>;
  onSaved: (name: string) => void;
}) {
  const saved = useRef(false);
  const field = useNameSubmit({
    onSubmit,
    messages,
    onSaved: (name) => {
      saved.current = true;
      onSaved(name);
      onClose();
    },
  });

  return (
    <AppSheet
      onOpenChange={(open) => !open && !field.pending && onClose()}
      title={title}
      description={description}
      returnFocusTo={(opener) =>
        (saved.current && savedRemovesOpener) || !opener
          ? returnFocusTo()
          : opener
      }
    >
      <form
        className="flex flex-1 flex-col"
        onSubmit={(event) => {
          event.preventDefault();
          field.submit();
        }}
      >
        <div className="p-4">
          <NameField
            inputRef={field.input}
            error={field.error}
            defaultValue={defaultValue}
            required
            autoFocus
          />
        </div>
        {/* aria-disabled while pending, not disabled: a disabled button drops
            its focus to the page. */}
        <SheetFooter className="border-t">
          <Button
            type="submit"
            aria-disabled={field.pending}
            className="aria-disabled:opacity-50"
          >
            {field.pending ? "Guardando…" : submitLabel}
          </Button>
        </SheetFooter>
      </form>
    </AppSheet>
  );
}
