"use client";

import { DialogActions } from "@/components/ui/dialog-actions";
import { type Placement, placementFigures } from "@plant/core";
import { addDays, daysBetween } from "@plant/shared";
import { useId, useState } from "react";

import { useFieldAlert } from "@/components/portfolio-setup/field-alert";
import { useSavedFocus } from "@/components/portfolio-setup/saved-focus";
import { AppDialog } from "@/components/ui/app-dialog";
import { FormAlert } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  formatAmount,
  percentInput,
  percentToFraction,
} from "@/lib/format/amount";
import { renewalInputSchema } from "@/lib/holdings/placement";

import { FIELD_MESSAGES } from "./holding-fields";

type RenewField = "startedOn" | "maturesOn" | "rate";
export type RenewFields = Record<RenewField, string>;

export const RENEW_MESSAGES = {
  dates:
    "La renovación empieza cuando vence la anterior o después, y vence más tarde.",
  rate: FIELD_MESSAGES.rate,
} as const;

const fieldOf = (text: string): RenewField | null =>
  text === RENEW_MESSAGES.dates
    ? "maturesOn"
    : text === RENEW_MESSAGES.rate
      ? "rate"
      : null;

// A renewal's fields to start with: from the day the placement matured, for
// a term as long as its, at its rate.
export function renewFields(placement: Placement): RenewFields {
  const days = daysBetween(placement.started_on, placement.matures_on);
  return {
    startedOn: placement.matures_on,
    maturesOn: addDays(placement.matures_on, days),
    rate: percentInput(placement.annual_rate),
  };
}

// What a renewal sends, or null for fields the store would refuse; the
// refused field's alert names it.
export function toRenewalInput(
  fields: RenewFields,
  placement: Placement,
): { input: unknown } | { refused: RenewField } {
  const rate = percentToFraction(fields.rate);
  if (rate === null) return { refused: "rate" };
  const input = {
    started_on: fields.startedOn,
    matures_on: fields.maturesOn,
    annual_rate: rate,
  };
  if (!renewalInputSchema.safeParse(input).success) {
    return { refused: "maturesOn" };
  }
  if (fields.startedOn < placement.matures_on) {
    return { refused: "maturesOn" };
  }
  return { input };
}

// Places a matured placement again: its capital plus the interest, on a new
// term and rate. It hands the input to `onSubmit` as it closes.
export function RenewDialog({
  name,
  placement,
  today,
  initialError,
  returnFocusTo,
  onClose,
  onSubmit,
}: {
  name: string;
  placement: Placement;
  today: string;
  initialError?: string;
  returnFocusTo: () => HTMLElement | null;
  onClose: () => void;
  // False when the write could not start; the dialog stays open.
  onSubmit: (input: unknown) => boolean;
}) {
  const id = useId();
  const fieldId = (field: RenewField) => `${id}-${field}`;
  const alertId = `${id}-alert`;
  const [fields, setFields] = useState(() => renewFields(placement));
  const { alert, setAlert, firstField, invalid, settle } =
    useFieldAlert<RenewField>(initialError, fieldOf, "maturesOn");
  const focus = useSavedFocus(returnFocusTo, false);
  const { maturityAmount } = placementFigures(placement, today);

  function submit() {
    const sent = toRenewalInput(fields, placement);
    if ("refused" in sent) {
      setAlert({
        field: sent.refused,
        text:
          sent.refused === "rate" ? RENEW_MESSAGES.rate : RENEW_MESSAGES.dates,
      });
      document.getElementById(fieldId(sent.refused))?.focus();
      return;
    }
    setAlert(undefined);
    if (!onSubmit(sent.input)) return;
    focus.markSaved();
    onClose();
  }

  const control = (field: RenewField) => ({
    id: fieldId(field),
    "aria-invalid": invalid(field),
    "aria-describedby": invalid(field) && alertId,
    autoFocus: firstField === field,
    value: fields[field],
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
      const { value } = event.target;
      setFields((current) => ({ ...current, [field]: value }));
      settle(field);
    },
    autoComplete: "off",
  });

  return (
    <AppDialog
      onClose={onClose}
      title="Renovar"
      description={`${name}. Se coloca de nuevo con ${formatAmount(maturityAmount, placement.currency)}: el capital más el interés.`}
      returnFocusTo={focus.returnFocusTo}
    >
      <form
        className="grid gap-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-2">
            <Label htmlFor={fieldId("startedOn")}>Desde</Label>
            <Input {...control("startedOn")} type="date" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={fieldId("maturesOn")}>Vence</Label>
            <Input {...control("maturesOn")} type="date" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={fieldId("rate")}>TNA (%)</Label>
            <Input {...control("rate")} inputMode="decimal" />
          </div>
        </div>
        {alert && <FormAlert id={alertId}>{alert.text}</FormAlert>}
        <DialogActions
          submitLabel="Renovar"
          describedBy={alert ? alertId : undefined}
        />
      </form>
    </AppDialog>
  );
}
