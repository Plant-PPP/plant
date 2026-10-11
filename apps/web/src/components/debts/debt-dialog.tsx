"use client";

import { LIABILITY_KINDS, liabilityInputSchema } from "@plant/core";
import { useId, useState } from "react";

import { useSavedFocus } from "@/components/portfolio-setup/saved-focus";
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
import { Switch } from "@/components/ui/switch";
import { CURRENCY_LABELS } from "@/lib/holdings/messages";
import type { InstrumentRow } from "@/lib/holdings/read";

import {
  type DebtFields,
  LIABILITY_KIND_LABELS,
  toLiabilityInput,
  unitOf,
  withKind,
} from "./debt-fields";

export const DEBT_INVALID =
  "Revisá la deuda: un nombre, un saldo mayor a 0 y, si los cargás, una cuota, una tasa de hasta 1000 % y fechas válidas.";

// Adds or edits a debt; it hands its fields to `onSubmit` as it closes, and a
// refused write opens it again with the fields and the alert.
export function DebtDialog({
  mode,
  initial,
  initialError,
  instruments,
  returnFocusTo,
  onClose,
  onSubmit,
}: {
  mode: "create" | "edit";
  initial: DebtFields;
  initialError?: string;
  instruments: InstrumentRow[];
  returnFocusTo: () => HTMLElement | null;
  onClose: () => void;
  // False when the write could not start; the dialog stays open.
  onSubmit: (fields: DebtFields) => boolean;
}) {
  const id = useId();
  const [fields, setFields] = useState(initial);
  const [alert, setAlert] = useState(initialError);
  const focus = useSavedFocus(returnFocusTo, false);
  const crypto = fields.kind === "crypto_loan";
  const canUva =
    (fields.kind === "mortgage" || fields.kind === "personal_loan") &&
    fields.currency === "ARS";
  const unit = unitOf({
    currency: crypto ? null : fields.currency,
    uva: canUva && fields.uva,
    instrument_symbol: crypto ? fields.instrument || "—" : null,
  });

  const set =
    <K extends keyof DebtFields>(key: K) =>
    (value: DebtFields[K]) => {
      setFields((current) => ({ ...current, [key]: value }));
      setAlert(undefined);
    };

  function submit() {
    if (!liabilityInputSchema.safeParse(toLiabilityInput(fields)).success) {
      setAlert(DEBT_INVALID);
      return;
    }
    if (!onSubmit(fields)) return;
    focus.markSaved();
    onClose();
  }

  const text = (
    key: Exclude<keyof DebtFields, "kind" | "currency" | "uva">,
    label: string,
    props: React.ComponentProps<typeof Input> = {},
  ) => (
    <div className="grid gap-2">
      <Label htmlFor={`${id}-${key}`}>{label}</Label>
      <Input
        id={`${id}-${key}`}
        value={fields[key]}
        onChange={(event) => set(key)(event.target.value)}
        autoComplete="off"
        {...props}
      />
    </div>
  );

  return (
    <AppDialog
      onClose={onClose}
      title={mode === "create" ? "Agregar deuda" : "Editar deuda"}
      description="Lo que debés hoy y cómo lo vas pagando."
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
            <Label htmlFor={`${id}-kind`}>Tipo</Label>
            <Select
              value={fields.kind}
              onValueChange={(value) => {
                if (!value) return;
                setFields((current) =>
                  withKind(current, value as DebtFields["kind"]),
                );
              }}
            >
              <SelectTrigger id={`${id}-kind`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LIABILITY_KINDS.map((kind) => (
                  <SelectItem key={kind} value={kind}>
                    {LIABILITY_KIND_LABELS[kind]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {crypto ? (
            <div className="grid gap-2">
              <Label htmlFor={`${id}-instrument`}>Cripto</Label>
              <Select
                value={fields.instrument}
                onValueChange={(value) => value && set("instrument")(value)}
              >
                <SelectTrigger id={`${id}-instrument`} className="w-full">
                  <SelectValue placeholder="Elegí una" />
                </SelectTrigger>
                <SelectContent>
                  {instruments
                    .filter((each) => each.type === "crypto")
                    .map((each) => (
                      <SelectItem key={each.symbol} value={each.symbol}>
                        {`${each.symbol} · ${each.name}`}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="grid gap-2">
              <Label htmlFor={`${id}-currency`}>Moneda</Label>
              <Select
                value={fields.currency}
                disabled={fields.kind === "usd_debt"}
                onValueChange={(value) =>
                  value && set("currency")(value as DebtFields["currency"])
                }
              >
                <SelectTrigger id={`${id}-currency`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["ARS", "USD"] as const).map((each) => (
                    <SelectItem key={each} value={each}>
                      {CURRENCY_LABELS[each]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          {text("label", "Nombre", { placeholder: "Hipoteca, Visa…" })}
          {text("lender", "Con quién (opcional)", {
            placeholder: "Banco, persona…",
          })}
        </div>
        {canUva && (
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor={`${id}-uva`}>
              En UVA
              <span className="text-muted-foreground block text-xs font-normal">
                El saldo y la cuota se cargan en UVA y se pasan a pesos con la
                UVA del día.
              </span>
            </Label>
            <Switch
              id={`${id}-uva`}
              checked={fields.uva}
              onCheckedChange={set("uva")}
            />
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          {text("balance", `Saldo (${unit})`, { inputMode: "decimal" })}
          {text("installment", `Cuota (${unit}, opcional)`, {
            inputMode: "decimal",
          })}
        </div>
        <div className="grid grid-cols-2 gap-3">
          {text("rate", "Tasa anual % (opcional)", { inputMode: "decimal" })}
          {text("installmentsLeft", "Cuotas que quedan (opcional)", {
            inputMode: "numeric",
          })}
        </div>
        <div className="grid grid-cols-2 gap-3">
          {text("nextDueOn", "Próximo vencimiento (opcional)", {
            type: "date",
          })}
          {text("maturesOn", "Termina (opcional)", { type: "date" })}
        </div>
        {alert && <FormAlert id={`${id}-alert`}>{alert}</FormAlert>}
        <DialogFooter>
          <Button type="submit" size="sm">
            {mode === "create" ? "Agregar" : "Guardar"}
          </Button>
        </DialogFooter>
      </form>
    </AppDialog>
  );
}
