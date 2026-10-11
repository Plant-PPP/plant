"use client";

import { type InstrumentType, manualPriceSchema } from "@plant/core";
import type { Currency } from "@plant/shared";
import { useId, useState } from "react";

import { useFieldAlert } from "@/components/portfolio-setup/field-alert";
import { useSavedFocus } from "@/components/portfolio-setup/saved-focus";
import { AppDialog } from "@/components/ui/app-dialog";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { FormAlert } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CURRENCY_LABELS, PRICE_MESSAGES } from "@/lib/holdings/messages";
import {
  type PriceFields,
  priceBasisLabel,
  toPriceInput,
} from "@/lib/holdings/price-input";

type PriceField = "price" | "date";

const fieldOf = (text: string): PriceField | null =>
  text === PRICE_MESSAGES.future_date
    ? "date"
    : text === PRICE_MESSAGES.invalid
      ? "price"
      : null;

// States an instrument's price as of a date, for one the feeds do not price;
// it hands its fields to `onSubmit` as it closes, and a refused write opens it
// again with the fields and the alert.
export function PriceDialog({
  instrument,
  initial,
  initialError,
  today,
  returnFocusTo,
  onClose,
  onSubmit,
  onDelete,
}: {
  instrument: {
    symbol: string;
    name: string;
    currency: Currency;
    type: InstrumentType;
  };
  initial: PriceFields;
  initialError?: string;
  today: string;
  returnFocusTo: () => HTMLElement | null;
  onClose: () => void;
  // False when the write could not start; the dialog stays open.
  onSubmit: (fields: PriceFields) => boolean;
  // Deletes the manual price it opened with, when it opened with one.
  onDelete?: () => boolean;
}) {
  const id = useId();
  const fieldId = (field: PriceField) => `${id}-${field}`;
  const alertId = `${id}-alert`;
  const [fields, setFields] = useState(initial);
  const { alert, setAlert, firstField, invalid, settle } =
    useFieldAlert<PriceField>(initialError, fieldOf, "price");
  const focus = useSavedFocus(returnFocusTo, false);

  function submit() {
    if (
      !manualPriceSchema.safeParse(toPriceInput(fields, instrument)).success
    ) {
      setAlert({ field: "price", text: PRICE_MESSAGES.invalid });
      document.getElementById(fieldId("price"))?.focus();
      return;
    }
    if (fields.date > today) {
      setAlert({ field: "date", text: PRICE_MESSAGES.future_date });
      document.getElementById(fieldId("date"))?.focus();
      return;
    }
    setAlert(undefined);
    if (!onSubmit(fields)) return;
    focus.markSaved();
    onClose();
  }

  const control = (field: PriceField) => ({
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
      title="Cargar precio"
      description={`${instrument.symbol} · ${instrument.name}. Lo usamos hasta que cargues otro.`}
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
            <Label htmlFor={fieldId("price")}>
              {`Precio ${priceBasisLabel(instrument.type)}`}
            </Label>
            <Input {...control("price")} inputMode="decimal" />
            <p className="text-muted-foreground text-xs">
              {CURRENCY_LABELS[instrument.currency]}
            </p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor={fieldId("date")}>Fecha</Label>
            <Input {...control("date")} type="date" max={today} />
          </div>
        </div>
        {alert && <FormAlert id={alertId}>{alert.text}</FormAlert>}
        <DialogFooter>
          {onDelete && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-destructive sm:mr-auto"
              onClick={() => {
                if (!onDelete()) return;
                focus.markSaved();
                onClose();
              }}
            >
              Borrar este precio
            </Button>
          )}
          <Button
            type="submit"
            size="sm"
            aria-describedby={alert ? alertId : undefined}
          >
            Guardar
          </Button>
        </DialogFooter>
      </form>
    </AppDialog>
  );
}
