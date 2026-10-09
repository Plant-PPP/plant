"use client";

import { useRef, useState } from "react";
import { AppDialog } from "@/components/ui/app-dialog";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { normalizeName } from "@/lib/portfolio-setup/normalize-name";
import { NameField } from "./name-field";
import { useSavedFocus } from "./saved-focus";

// A dialog that asks for one name and hands it to `onSubmit` as it closes:
// creating, renaming, or restoring under a new name. A refused write opens it
// again with the name and the alert (`initial`, `initialError`). It stays open
// when the name is blank or `onSubmit` could not start the write.
export function NameDialog({
  onClose,
  title,
  description,
  submitLabel,
  initial = "",
  initialError,
  blankError,
  returnFocusTo,
  savedRemovesOpener = false,
  onSubmit,
}: {
  onClose: () => void;
  title: string;
  description: string;
  submitLabel: string;
  initial?: string;
  initialError?: string;
  // Shown when the name is only spaces.
  blankError: string;
  // Where focus goes when the opener is gone (see useSavedFocus).
  returnFocusTo: () => HTMLElement | null;
  savedRemovesOpener?: boolean;
  onSubmit: (name: string) => boolean;
}) {
  const focus = useSavedFocus(returnFocusTo, savedRemovesOpener);
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState(initialError);

  return (
    <AppDialog
      onClose={onClose}
      title={title}
      description={description}
      returnFocusTo={focus.returnFocusTo}
    >
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          const name = normalizeName(input.current?.value ?? "");
          if (name === "") {
            setError(blankError);
            input.current?.focus();
            return;
          }
          setError(undefined);
          if (!onSubmit(name)) return;
          focus.markSaved();
          onClose();
        }}
      >
        <NameField
          inputRef={input}
          error={error}
          defaultValue={initial}
          required
          autoFocus
        />
        <DialogFooter>
          <Button type="submit" size="sm">
            {submitLabel}
          </Button>
        </DialogFooter>
      </form>
    </AppDialog>
  );
}
