"use client";

import { useRef } from "react";
import { AppDialog } from "@/components/ui/app-dialog";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import type { WriteResult } from "@/lib/portfolio-setup/write-result";
import type { WriteMessages } from "./answers";
import { NameField, useNameSubmit } from "./name-field";

// A dialog that asks for one name and saves it with `onSubmit`: creating,
// renaming, or restoring under a new name.
export function NameDialog({
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
    <AppDialog
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
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          field.submit();
        }}
      >
        <NameField
          inputRef={field.input}
          error={field.error}
          defaultValue={defaultValue}
          required
          autoFocus
        />
        {/* aria-disabled while pending, not disabled: a disabled button drops
            its focus to the page. */}
        <DialogFooter>
          <Button
            type="submit"
            aria-disabled={field.pending}
            className="aria-disabled:opacity-50"
          >
            {field.pending ? "Guardando…" : submitLabel}
          </Button>
        </DialogFooter>
      </form>
    </AppDialog>
  );
}
