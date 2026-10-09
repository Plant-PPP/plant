"use client";

import { useId, useState, useTransition } from "react";
import { AppSheet } from "@/components/ui/app-sheet";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SheetFooter } from "@/components/ui/sheet";
import { WRITE_MESSAGES } from "@/lib/portfolio-setup/messages";
import type { WriteResult } from "@/lib/portfolio-setup/write-result";

// A sheet that asks for one name and saves it with `onSubmit`: creating,
// renaming, or restoring under a new name.
export function NameSheet({
  onClose,
  title,
  description,
  submitLabel,
  defaultValue = "",
  onSubmit,
}: {
  onClose: () => void;
  title: string;
  description: string;
  submitLabel: string;
  defaultValue?: string;
  onSubmit: (name: string) => Promise<WriteResult>;
}) {
  const inputId = useId();
  const alertId = useId();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();

  function submit(form: HTMLFormElement) {
    const name = String(new FormData(form).get("name") ?? "");
    setError(undefined);
    startTransition(async () => {
      try {
        const result = await onSubmit(name);
        if (result.ok) onClose();
        else setError(WRITE_MESSAGES[result.code]);
      } catch {
        setError(WRITE_MESSAGES.failed);
      }
    });
  }

  return (
    <AppSheet
      open
      onOpenChange={(open) => !open && !pending && onClose()}
      title={title}
      description={description}
    >
      <form
        className="flex flex-1 flex-col"
        onSubmit={(event) => {
          event.preventDefault();
          submit(event.currentTarget);
        }}
      >
        <div className="grid gap-2 p-4">
          <Label htmlFor={inputId}>Nombre</Label>
          <Input
            id={inputId}
            name="name"
            defaultValue={defaultValue}
            required
            autoComplete="off"
            autoFocus
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? alertId : undefined}
          />
          {error && <FormAlert id={alertId}>{error}</FormAlert>}
        </div>
        <SheetFooter className="border-t">
          <Button type="submit" disabled={pending}>
            {pending ? "Guardando…" : submitLabel}
          </Button>
        </SheetFooter>
      </form>
    </AppSheet>
  );
}
