"use client";

import { AppDialog } from "@/components/ui/app-dialog";
import { DialogFooter } from "@/components/ui/dialog";
import type { WriteResult } from "@/lib/portfolio-setup/write-result";
import type { WriteMessages } from "./answers";
import { NameField, useNameSubmit } from "./name-field";
import { useSavedFocus } from "./saved-focus";
import { PendingButton } from "@/components/ui/pending-button";

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
  // Where focus goes when the opener is gone (see useSavedFocus).
  returnFocusTo: () => HTMLElement | null;
  savedRemovesOpener?: boolean;
  messages: WriteMessages;
  onSubmit: (name: string) => Promise<WriteResult>;
  onSaved: (name: string) => void;
}) {
  const focus = useSavedFocus(returnFocusTo, savedRemovesOpener);
  const field = useNameSubmit({
    onSubmit,
    messages,
    onSaved: (name) => {
      focus.markSaved();
      onSaved(name);
      onClose();
    },
  });

  return (
    <AppDialog
      onClose={onClose}
      pending={field.pending}
      title={title}
      description={description}
      returnFocusTo={focus.returnFocusTo}
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
        <DialogFooter>
          <PendingButton type="submit" size="sm" pending={field.pending}>
            {field.pending ? "Guardando…" : submitLabel}
          </PendingButton>
        </DialogFooter>
      </form>
    </AppDialog>
  );
}
