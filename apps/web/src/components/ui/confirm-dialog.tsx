"use client";

import { AppDialog } from "@/components/ui/app-dialog";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";

// Asks before a write that cannot be undone, such as a delete; the confirm
// button names the action and takes focus, so Enter confirms and Escape
// cancels.
export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  returnFocusTo,
  onClose,
  onConfirm,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  returnFocusTo?: (opener: HTMLElement | null) => HTMLElement | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <AppDialog
      onClose={onClose}
      title={title}
      description={description}
      returnFocusTo={returnFocusTo}
    >
      <DialogFooter>
        <Button type="button" size="sm" variant="outline" onClick={onClose}>
          Cancelar
        </Button>
        <Button
          type="button"
          size="sm"
          variant="destructive"
          autoFocus
          onClick={() => {
            onClose();
            onConfirm();
          }}
        >
          {confirmLabel}
        </Button>
      </DialogFooter>
    </AppDialog>
  );
}
