"use client";

import { HandCoins } from "lucide-react";
import { useId, useState } from "react";

import { useSavedFocus } from "@/components/portfolio-setup/saved-focus";
import { AppDialog } from "@/components/ui/app-dialog";
import { DialogActions } from "@/components/ui/dialog-actions";
import { FormAlert } from "@/components/ui/form-alert";

// A deposit that may have brought a loan's money in, as the page names it.
export type DisbursementChoice = {
  operationId: string;
  label: string;
  place: string;
};

// Picks the deposit a loan's money came in with, or none; it hands the
// operation's id to `onSubmit` as it closes.
export function DebtDisbursementDialog({
  options,
  initial,
  initialError,
  returnFocusTo,
  onClose,
  onSubmit,
}: {
  options: readonly DisbursementChoice[];
  initial: string | null;
  initialError?: string;
  returnFocusTo: () => HTMLElement | null;
  onClose: () => void;
  onSubmit: (operationId: string | null) => boolean;
}) {
  const id = useId();
  const [chosen, setChosen] = useState(initial);
  const focus = useSavedFocus(returnFocusTo, false);
  const choices = [
    ...options.map((option) => ({
      value: option.operationId as string | null,
      label: option.label,
      place: option.place,
    })),
    { value: null, label: "Ninguno", place: "No entró en una de tus cuentas" },
  ];

  return (
    <AppDialog
      onClose={onClose}
      title="Desembolso"
      description="Dónde entró la plata del préstamo. Ese movimiento se muestra como préstamo, no como depósito."
      icon={HandCoins}
      returnFocusTo={focus.returnFocusTo}
    >
      <form
        className="grid gap-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!onSubmit(chosen)) return;
          focus.markSaved();
          onClose();
        }}
      >
        <fieldset className="grid max-h-72 gap-3 overflow-y-auto">
          <legend className="sr-only">Desembolso</legend>
          {choices.map((choice) => {
            const inputId = `${id}-${choice.value ?? "none"}`;
            return (
              <label
                key={inputId}
                htmlFor={inputId}
                className="flex cursor-pointer items-start gap-3 text-sm"
              >
                <input
                  id={inputId}
                  type="radio"
                  name={`${id}-disbursement`}
                  className="accent-primary mt-1"
                  checked={chosen === choice.value}
                  onChange={() => setChosen(choice.value)}
                />
                <span className="grid gap-0.5">
                  <span>{choice.label}</span>
                  <span className="text-muted-foreground text-xs">
                    {choice.place}
                  </span>
                </span>
              </label>
            );
          })}
        </fieldset>
        {initialError && (
          <FormAlert id={`${id}-alert`}>{initialError}</FormAlert>
        )}
        <DialogActions
          submitLabel="Guardar"
          describedBy={initialError ? `${id}-alert` : undefined}
        />
      </form>
    </AppDialog>
  );
}
