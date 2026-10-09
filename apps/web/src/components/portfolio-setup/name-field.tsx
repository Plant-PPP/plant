"use client";

import type * as React from "react";
import { useId, useRef, useState, useTransition } from "react";
import { FormAlert } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { normalizeName } from "@/lib/portfolio-setup/normalize-name";
import type { WriteResult } from "@/lib/portfolio-setup/write-result";
import { settle } from "@/lib/server-action-call";
import { type WriteMessages, sheetAnswer } from "./answers";

export type NameSubmit = ReturnType<typeof useNameSubmit>;

// Saves the name typed in its field with `onSubmit`; a refusal shows next to
// the field and puts focus back in it.
export function useNameSubmit({
  onSubmit,
  messages,
  onSaved,
}: {
  onSubmit: (name: string) => Promise<WriteResult>;
  messages: WriteMessages;
  onSaved: (name: string, id: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const input = useRef<HTMLInputElement>(null);

  function submit() {
    if (pending) return;
    const name = input.current?.value ?? "";
    setError(undefined);
    startTransition(async () => {
      const result = await settle(onSubmit(name));
      if (result !== "rejected" && result.ok) {
        onSaved(normalizeName(name), result.id);
        return;
      }
      const answer = sheetAnswer(result, messages);
      if (answer.kind === "alert") setError(answer.text);
      input.current?.focus();
    });
  }

  return { pending, error, submit, input };
}

// The label, the input and its alert, with no form of their own, so a sheet's
// form or another form's inline field can hold them.
export function NameField({
  inputRef,
  error,
  label = "Nombre",
  ...props
}: {
  inputRef: NameSubmit["input"];
  error: string | undefined;
  label?: string;
} & Omit<React.ComponentProps<typeof Input>, "ref" | "id">) {
  const inputId = useId();
  const alertId = useId();
  return (
    <div className="grid gap-2">
      <Label htmlFor={inputId}>{label}</Label>
      <Input
        ref={inputRef}
        id={inputId}
        autoComplete="off"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? alertId : undefined}
        {...props}
      />
      {error && <FormAlert id={alertId}>{error}</FormAlert>}
    </div>
  );
}
