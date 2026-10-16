"use client";

import { ShieldCheck } from "lucide-react";
import { useId, useState } from "react";

import { useSavedFocus } from "@/components/portfolio-setup/saved-focus";
import { AppDialog } from "@/components/ui/app-dialog";
import { DialogActions } from "@/components/ui/dialog-actions";
import { FormAlert } from "@/components/ui/form-alert";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

// A holding that can be pledged for a debt, as the page names it.
export type PledgeOption = {
  id: string;
  label: string;
  place: string;
  // Its value in the page's unit, or null without a quote.
  value: string | null;
};

// Picks the holdings pledged for a debt; it hands the ids to `onSubmit` as it
// closes.
export function DebtCollateralDialog({
  options,
  initial,
  initialError,
  returnFocusTo,
  onClose,
  onSubmit,
}: {
  options: readonly PledgeOption[];
  initial: readonly string[];
  initialError?: string;
  returnFocusTo: () => HTMLElement | null;
  onClose: () => void;
  onSubmit: (holdingIds: string[]) => boolean;
}) {
  const id = useId();
  const [chosen, setChosen] = useState(() => new Set(initial));
  const focus = useSavedFocus(returnFocusTo, false);

  return (
    <AppDialog
      onClose={onClose}
      title="Garantía"
      description="Lo que dejaste como garantía del préstamo, para ver cuánto cubre."
      icon={ShieldCheck}
      returnFocusTo={focus.returnFocusTo}
    >
      <form
        className="grid gap-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!onSubmit([...chosen])) return;
          focus.markSaved();
          onClose();
        }}
      >
        {options.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            Todavía no tenés activos para dejar en garantía.
          </p>
        ) : (
          <ul className="grid max-h-72 gap-3 overflow-y-auto">
            {options.map((option) => (
              <li
                key={option.id}
                className="flex items-center justify-between gap-4"
              >
                <Label htmlFor={`${id}-${option.id}`} className="grid gap-0.5">
                  <span>{option.label}</span>
                  <span className="text-muted-foreground font-normal">
                    {option.place}
                  </span>
                </Label>
                <Switch
                  id={`${id}-${option.id}`}
                  aria-label={`${option.label}, ${option.place}`}
                  checked={chosen.has(option.id)}
                  onCheckedChange={(on) =>
                    setChosen((current) => {
                      const next = new Set(current);
                      if (on) next.add(option.id);
                      else next.delete(option.id);
                      return next;
                    })
                  }
                />
              </li>
            ))}
          </ul>
        )}
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
