"use client";

import { useId, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormAlert } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { normalizeName } from "@/lib/portfolio-setup/normalize-name";
import { settle } from "@/lib/server-action-call";
import type { WriteResult } from "@/lib/portfolio-setup/write-result";
import { dialogAnswer } from "./answers";

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
  // Opened by state with no DialogTrigger, so Radix has no trigger to return
  // focus to: keep whatever had focus when the dialog first rendered, before
  // its own autofocus moves it.
  const [opener] = useState(() =>
    typeof document === "undefined" ? null : document.activeElement,
  );

  // The submit button is aria-disabled while pending, not disabled: a disabled
  // button drops its focus to the page.
  function submit(form: HTMLFormElement) {
    if (pending) return;
    const name = String(new FormData(form).get("name") ?? "");
    setError(undefined);
    startTransition(async () => {
      const answer = dialogAnswer(await settle(onSubmit(name)));
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
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent
        className="sm:max-w-md"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          // A click does not focus a button in Safari or Firefox on macOS,
          // so the opener can be the page itself.
          const present =
            opener instanceof HTMLElement &&
            opener !== document.body &&
            opener.isConnected
              ? opener
              : null;
          const target =
            (saved.current && savedRemovesOpener) || !present
              ? returnFocusTo()
              : present;
          if (target?.isConnected) target.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit(event.currentTarget);
          }}
        >
          <div className="grid gap-2">
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
          <DialogFooter>
            <Button
              type="submit"
              aria-disabled={pending}
              className="aria-disabled:opacity-50"
            >
              {pending ? "Guardando…" : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
