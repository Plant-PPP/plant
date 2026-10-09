"use client";

import { useId, useRef, useState, useTransition } from "react";
import { AppSheet } from "@/components/ui/app-sheet";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SheetFooter } from "@/components/ui/sheet";
import { normalizeName } from "@/lib/portfolio-setup/schemas";
import { settle } from "@/lib/server-action-call";
import type { WriteResult } from "@/lib/portfolio-setup/write-result";
import { sheetAnswer } from "./answers";

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
  onSubmit: (name: string) => Promise<WriteResult>;
  onSaved: (name: string) => void;
}) {
  const inputId = useId();
  const alertId = useId();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const saved = useRef(false);
  const input = useRef<HTMLInputElement>(null);

  function submit(form: HTMLFormElement) {
    const name = String(new FormData(form).get("name") ?? "");
    setError(undefined);
    startTransition(async () => {
      const answer = sheetAnswer(await settle(onSubmit(name)));
      if (answer.kind === "done") {
        saved.current = true;
        onSaved(normalizeName(name));
        onClose();
      } else {
        setError(answer.text);
        input.current?.focus();
      }
    });
  }

  return (
    <AppSheet
      onOpenChange={(open) => !open && !pending && onClose()}
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
          submit(event.currentTarget);
        }}
      >
        <div className="grid gap-2 p-4">
          <Label htmlFor={inputId}>Nombre</Label>
          <Input
            ref={input}
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
