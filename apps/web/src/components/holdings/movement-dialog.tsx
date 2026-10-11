"use client";

import { allowedKinds, isIncome, type MovementKind } from "@plant/core";
import type { Currency } from "@plant/shared";
import type * as React from "react";
import { useId, useState } from "react";

import { AppDialog } from "@/components/ui/app-dialog";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { FormAlert } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useFieldAlert } from "@/components/portfolio-setup/field-alert";
import { useSavedFocus } from "@/components/portfolio-setup/saved-focus";
import { CURRENCY_LABELS, MOVEMENT_KIND_LABELS } from "@/lib/holdings/messages";
import { movementInputSchema } from "@/lib/holdings/schemas";

import {
  type MovementField,
  type MovementFields,
  movementRefusal,
  refusedMovementField,
  toMovementInput,
} from "./movement-fields";

// A holding the dialog can record a movement for, and whether it has any.
export type MovementHolding = {
  id: string;
  name: string;
  hasMovements: boolean;
};

// Records a movement of an instrument holding, or edits one, handing its
// fields to `onSubmit` as it closes; a refused write opens it again with the
// fields and the alert. A holding's first movement is its opening balance.
export function MovementDialog({
  mode,
  holdings,
  initial,
  initialError,
  today,
  returnFocusTo,
  onClose,
  onSubmit,
}: {
  mode: "create" | "edit";
  // The holdings to choose from; one when opened from a holding.
  holdings: MovementHolding[];
  initial: MovementFields;
  initialError?: string;
  today: string;
  returnFocusTo: () => HTMLElement | null;
  onClose: () => void;
  // False when the write could not start; the dialog stays open.
  onSubmit: (fields: MovementFields) => boolean;
}) {
  const id = useId();
  const fieldId = (field: MovementField) => `${id}-${field}`;
  const alertId = `${id}-alert`;
  const [fields, setFields] = useState(initial);
  const { alert, setAlert, firstField, invalid, settle, pick } =
    useFieldAlert<MovementField>(
      initialError,
      refusedMovementField,
      holdings.length > 1 ? "holding" : "kind",
    );
  const focus = useSavedFocus(returnFocusTo, false);
  const holding = holdings.find((each) => each.id === fields.holdingId);
  // An edit keeps its kind among those the holding takes: the opening balance
  // stays one, and nothing else becomes one.
  const kinds: MovementKind[] =
    mode === "edit"
      ? fields.kind === "opening_balance"
        ? ["opening_balance"]
        : allowedKinds(true)
      : allowedKinds(holding?.hasMovements ?? false);
  const income = isIncome(fields.kind);

  const set =
    <K extends keyof MovementFields>(key: K) =>
    (value: MovementFields[K]) =>
      setFields((current) => ({ ...current, [key]: value }));

  const control = (field: MovementField) => ({
    id: fieldId(field),
    "aria-invalid": invalid(field),
    "aria-describedby": invalid(field) && alertId,
    autoFocus: firstField === field,
  });

  function submit() {
    const parsed = movementInputSchema.safeParse(toMovementInput(fields));
    if (!parsed.success) {
      const refused = movementRefusal(parsed.error);
      setAlert(refused);
      if (refused.field)
        document.getElementById(fieldId(refused.field))?.focus();
      return;
    }
    setAlert(undefined);
    if (!onSubmit(fields)) return;
    focus.markSaved();
    onClose();
  }

  const textField = (
    field: Extract<MovementField, keyof MovementFields>,
    label: string,
    props: React.ComponentProps<typeof Input> = {},
  ) => (
    <div className="grid gap-2">
      <Label htmlFor={fieldId(field)}>{label}</Label>
      <Input
        {...control(field)}
        value={fields[field]}
        onChange={(event) => {
          set(field)(event.target.value);
          settle(field);
        }}
        autoComplete="off"
        {...props}
      />
    </div>
  );

  return (
    <AppDialog
      onClose={onClose}
      title={mode === "create" ? "Agregar movimiento" : "Editar movimiento"}
      description={
        holding && holdings.length === 1
          ? holding.name
          : "Una compra, una venta o un cobro de una tenencia."
      }
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
        <div className="grid gap-4">
          {holdings.length > 1 && (
            <div className="grid gap-2">
              <Label htmlFor={fieldId("holding")}>Tenencia</Label>
              <Select
                value={fields.holdingId}
                onValueChange={pick("holding", (value) => {
                  const next = holdings.find((each) => each.id === value);
                  setFields((current) => ({
                    ...current,
                    holdingId: value,
                    kind: allowedKinds(next?.hasMovements ?? false).includes(
                      current.kind,
                    )
                      ? current.kind
                      : allowedKinds(next?.hasMovements ?? false)[0]!,
                  }));
                })}
              >
                <SelectTrigger {...control("holding")} className="w-full">
                  <SelectValue placeholder="Elegí una tenencia" />
                </SelectTrigger>
                <SelectContent>
                  {holdings.map((each) => (
                    <SelectItem key={each.id} value={each.id}>
                      {each.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid gap-2">
            <Label htmlFor={fieldId("kind")}>Tipo</Label>
            <Select
              value={fields.kind}
              onValueChange={pick("kind", (value) =>
                set("kind")(value as MovementKind),
              )}
            >
              <SelectTrigger {...control("kind")} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {kinds.map((each) => (
                  <SelectItem key={each} value={each}>
                    {MOVEMENT_KIND_LABELS[each]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {textField("date", "Fecha", { type: "date", max: today })}
          {income ? (
            textField("amount", "Monto", { inputMode: "decimal" })
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {textField("quantity", "Cantidad", { inputMode: "decimal" })}
              {textField("price", "Precio por unidad", {
                inputMode: "decimal",
              })}
            </div>
          )}
          <div className="grid gap-2">
            <Label htmlFor={fieldId("currency")}>Moneda</Label>
            <Select
              value={fields.currency}
              onValueChange={pick("currency", (value) =>
                set("currency")(value as Currency),
              )}
            >
              <SelectTrigger {...control("currency")} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(CURRENCY_LABELS) as Currency[]).map((each) => (
                  <SelectItem key={each} value={each}>
                    {CURRENCY_LABELS[each]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {textField("fees", "Comisiones (opcional)", {
              inputMode: "decimal",
            })}
            {textField("taxes", "Impuestos (opcional)", {
              inputMode: "decimal",
            })}
          </div>
          {alert && <FormAlert id={alertId}>{alert.text}</FormAlert>}
        </div>
        <DialogFooter>
          <Button
            type="submit"
            size="sm"
            aria-describedby={alert ? alertId : undefined}
          >
            {mode === "create" ? "Agregar" : "Guardar"}
          </Button>
        </DialogFooter>
      </form>
    </AppDialog>
  );
}
