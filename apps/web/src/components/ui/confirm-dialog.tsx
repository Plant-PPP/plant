"use client";

import { type ReactNode, useState } from "react";

import { useSavedFocus } from "@/components/portfolio-setup/saved-focus";
import { AppDialog } from "@/components/ui/app-dialog";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";

// Asks before a write that cannot be undone, such as a delete. It opens on
// Cancelar, so Enter never confirms by itself; cancelling returns focus to
// what opened it, and confirming, which removes that, to `returnFocusTo`.
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
  returnFocusTo: () => HTMLElement | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const focus = useSavedFocus(returnFocusTo, true);
  return (
    <AppDialog
      onClose={onClose}
      title={title}
      description={description}
      returnFocusTo={focus.returnFocusTo}
    >
      <DialogFooter>
        <Button
          type="button"
          size="sm"
          variant="outline"
          autoFocus
          onClick={onClose}
        >
          Cancelar
        </Button>
        <Button
          type="button"
          size="sm"
          variant="destructive"
          onClick={() => {
            focus.markSaved();
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

export type ConfirmSpec = {
  title: string;
  description: string;
  run: () => void;
};

// One confirmation at a time, for a page that asks before more than one kind
// of delete; it confirms with "Borrar".
export function useConfirm(returnFocusTo: () => HTMLElement | null): {
  confirm: (spec: ConfirmSpec) => void;
  dialog: ReactNode;
} {
  const [shown, setShown] = useState<ConfirmSpec | null>(null);
  return {
    confirm: setShown,
    dialog: shown && (
      <ConfirmDialog
        title={shown.title}
        description={shown.description}
        confirmLabel="Borrar"
        returnFocusTo={returnFocusTo}
        onClose={() => setShown(null)}
        onConfirm={shown.run}
      />
    ),
  };
}
