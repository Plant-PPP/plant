"use client";

import {
  LIABILITY_KINDS,
  liabilityFieldsFor,
  liabilityInputSchema,
} from "@plant/core";
import { Constants } from "@plant/shared";
import { Info, Landmark } from "lucide-react";
import { useId, useState } from "react";

import { useSavedFocus } from "@/components/portfolio-setup/saved-focus";
import { AppDialog } from "@/components/ui/app-dialog";
import { DialogActions, MoreFields } from "@/components/ui/dialog-actions";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CURRENCY_LABELS } from "@/lib/holdings/messages";
import type { InstrumentRow } from "@/lib/holdings/read";
import { instrumentLabel } from "@/lib/holdings/holding-name";

import {
  DEBT_INVALID,
  type DebtFields,
  LIABILITY_KIND_LABELS,
  toLiabilityInput,
  unitOf,
  withKind,
} from "./debt-fields";

// Adds or edits a debt; it hands its fields to `onSubmit` as it closes, and a
// refused write opens it again with the fields and the alert.
export function DebtDialog({
  mode,
  initial,
  initialError,
  instruments,
  returnFocusTo,
  check,
  onClose,
  onSubmit,
}: {
  mode: "create" | "edit";
  initial: DebtFields;
  initialError?: string;
  instruments: InstrumentRow[];
  returnFocusTo: () => HTMLElement | null;
  // The alert a debt's events raise for the fields, or null.
  check?: (fields: DebtFields) => string | null;
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
  const shown = liabilityFieldsFor(fields);
  const accrues = shown.accrues && fields.accrues;
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
    const refused = check?.(fields);
    if (refused) {
      setAlert(refused);
      return;
    }
    if (!onSubmit(fields)) return;
    focus.markSaved();
    onClose();
  }

  const text = (
    key: Exclude<keyof DebtFields, "kind" | "currency" | "uva" | "accrues">,
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
      icon={Landmark}
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
        <div className="grid grid-cols-2 gap-4">
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
                        {instrumentLabel(each.symbol, each.name)}
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
                  {Constants.public.Enums.currency.map((each) => (
                    <SelectItem key={each} value={each}>
                      {CURRENCY_LABELS[each]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-4">
          {text("label", "Nombre", {
            placeholder: "Hipoteca, Visa…",
            required: true,
          })}
          {text("balance", `Saldo (${unit})`, {
            inputMode: "decimal",
            required: true,
          })}
        </div>
        {shown.accrues && (
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-1.5">
              <Label htmlFor={`${id}-accrues`}>Acumula interés</Label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info
                    aria-label="Qué es"
                    className="text-muted-foreground size-3.5"
                  />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  Para un préstamo sin cuota, como uno cripto o entre personas:
                  el saldo crece todos los días con la tasa.
                </TooltipContent>
              </Tooltip>
            </div>
            <Switch
              id={`${id}-accrues`}
              checked={fields.accrues}
              onCheckedChange={set("accrues")}
            />
          </div>
        )}
        {accrues && (
          <div className="grid grid-cols-2 gap-4">
            {text("openedOn", "Saldo al", { type: "date", required: true })}
            {text("rate", "Tasa anual %", {
              inputMode: "decimal",
              required: true,
            })}
          </div>
        )}
        {canUva && (
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-1.5">
              <Label htmlFor={`${id}-uva`}>En UVA</Label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info
                    aria-label="Qué es"
                    className="text-muted-foreground size-3.5"
                  />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  El saldo y la cuota se cargan en UVA y se pasan a pesos con la
                  UVA del día.
                </TooltipContent>
              </Tooltip>
            </div>
            <Switch
              id={`${id}-uva`}
              checked={fields.uva}
              onCheckedChange={set("uva")}
            />
          </div>
        )}
        <MoreFields
          label={
            accrues
              ? "Con quién y cuándo termina"
              : "Con quién, cuota, tasa y vencimientos"
          }
          defaultOpen={(
            [
              "lender",
              "installment",
              "rate",
              "installmentsLeft",
              "nextDueOn",
              "maturesOn",
              "openedOn",
            ] as const
          ).some((key) => initial[key] !== "")}
        >
          {accrues ? (
            <div className="grid grid-cols-2 gap-4">
              {text("lender", "Con quién", { placeholder: "Banco, persona…" })}
              {text("maturesOn", "Termina", { type: "date" })}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4">
                {text("lender", "Con quién", {
                  placeholder: "Banco, persona…",
                })}
                {text("installment", `Cuota (${unit})`, {
                  inputMode: "decimal",
                })}
              </div>
              <div className="grid grid-cols-2 gap-4">
                {text("rate", "Tasa anual %", { inputMode: "decimal" })}
                {text("installmentsLeft", "Cuotas que quedan", {
                  inputMode: "numeric",
                })}
              </div>
              <div className="grid grid-cols-2 gap-4">
                {text("nextDueOn", "Próximo vencimiento", { type: "date" })}
                {text("maturesOn", "Termina", { type: "date" })}
              </div>
              {shown.accrues && text("openedOn", "Saldo al", { type: "date" })}
            </>
          )}
        </MoreFields>
        {alert && <FormAlert id={`${id}-alert`}>{alert}</FormAlert>}
        <DialogActions
          submitLabel={mode === "create" ? "Agregar" : "Guardar"}
        />
      </form>
    </AppDialog>
  );
}
