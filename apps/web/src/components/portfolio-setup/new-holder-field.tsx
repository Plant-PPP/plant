"use client";

import type * as React from "react";
import { useEffect } from "react";
import { createHolder } from "@/app/(app)/accounts/actions";
import { Button } from "@/components/ui/button";
import { WRITE_MESSAGES } from "@/lib/portfolio-setup/messages";
import type { HolderRow } from "@/lib/portfolio-setup/read";
import { NameField, useNameSubmit } from "./name-field";
import { PendingButton } from "@/components/ui/pending-button";

// Enter saves the holder instead of submitting the form around the field.
export function submitOnEnter(submit: () => void) {
  return (event: Pick<React.KeyboardEvent, "key" | "preventDefault">) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    submit();
  };
}

// Creates a holder from inside the account dialog's form. It has no form of
// its own, its input no name, so the account's form never sends it, and its
// buttons do not submit.
export function NewHolderField({
  onCreated,
  onCancel,
  onPendingChange,
}: {
  onCreated: (row: HolderRow) => void;
  onCancel: () => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const field = useNameSubmit({
    onSubmit: (name) => createHolder({ name }),
    messages: WRITE_MESSAGES.holders,
    onSaved: (name, id) => onCreated({ id, name }),
  });

  // Reports false once the field unmounts, or an unmount mid-save would hold
  // the dialog open.
  useEffect(() => {
    onPendingChange(field.pending);
    return () => onPendingChange(false);
  }, [field.pending, onPendingChange]);

  return (
    <div className="grid gap-2 rounded-md border p-3">
      <NameField
        inputRef={field.input}
        error={field.error}
        label="Nombre del titular"
        autoFocus
        onKeyDown={submitOnEnter(field.submit)}
      />
      <div className="flex gap-2">
        <PendingButton
          type="button"
          size="sm"
          pending={field.pending}
          onClick={field.submit}
        >
          {field.pending ? "Agregando…" : "Agregar titular"}
        </PendingButton>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
