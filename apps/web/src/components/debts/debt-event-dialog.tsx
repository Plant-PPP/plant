"use client";

import { HandCoins } from "lucide-react";
import { useId, useState } from "react";

import { useSavedFocus } from "@/components/portfolio-setup/saved-focus";
import { AppDialog } from "@/components/ui/app-dialog";
import { DialogActions } from "@/components/ui/dialog-actions";
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
import { formatAmount } from "@/lib/format/amount";

import {
  type CashOption,
  DEBT_EVENT_INVALID,
  type DebtEventFields,
  eventInputValid,
} from "./debt-event-fields";

const NO_ACCOUNT = "none";

const TITLES = {
  payment: ["Registrar pago", "Editar pago"],
  rate_change: ["Cambiar tasa", "Editar cambio de tasa"],
  adjustment: ["Ajustar saldo", "Editar ajuste de saldo"],
} as const;

const DESCRIPTIONS = {
  payment: "Lo que le pagaste al acreedor, en la unidad de la deuda.",
  rate_change: "La tasa nueva rige desde el día siguiente.",
  adjustment:
    "El saldo que dice el acreedor ese día; la diferencia cuenta como interés.",
} as const;

// Records or edits one event of a debt. It checks the fields, then a debt's
// rules through `check`, and hands them to `onSubmit` as it closes; a refused
// write opens it again with the fields and the alert.
export function DebtEventDialog({
  mode,
  initial,
  initialError,
  unit,
  cash,
  cashNote,
  check,
  returnFocusTo,
  onClose,
  onSubmit,
}: {
  mode: "create" | "edit";
  initial: DebtEventFields;
  initialError?: string;
  // The debt's unit, as amounts are typed in it.
  unit: string;
  // The cash holdings a payment can come from; null when the debt takes no
  // account (in an instrument, or in UVA).
  cash: readonly CashOption[] | null;
  cashNote: string;
  // The alert a debt's rules raise for the fields, or null.
  check: (fields: DebtEventFields) => string | null;
  returnFocusTo: () => HTMLElement | null;
  onClose: () => void;
  // False when the write could not start; the dialog stays open.
  onSubmit: (fields: DebtEventFields) => boolean;
}) {
  const id = useId();
  const [fields, setFields] = useState(initial);
  const [alert, setAlert] = useState(initialError);
  const focus = useSavedFocus(returnFocusTo, false);
  const kind = fields.kind;
  const chosen = cash?.find((each) => each.id === fields.cashHoldingId);

  const set =
    <K extends keyof DebtEventFields>(key: K) =>
    (value: DebtEventFields[K]) => {
      setFields((current) => ({ ...current, [key]: value }));
      setAlert(undefined);
    };

  function submit() {
    if (!eventInputValid(fields)) {
      setAlert(DEBT_EVENT_INVALID);
      return;
    }
    const refused = check(fields);
    if (refused) {
      setAlert(refused);
      return;
    }
    if (!onSubmit(fields)) return;
    focus.markSaved();
    onClose();
  }

  return (
    <AppDialog
      onClose={onClose}
      title={TITLES[kind][mode === "create" ? 0 : 1]}
      description={DESCRIPTIONS[kind]}
      icon={HandCoins}
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
            <Label htmlFor={`${id}-date`}>Fecha</Label>
            <Input
              id={`${id}-date`}
              type="date"
              required
              value={fields.date}
              onChange={(event) => set("date")(event.target.value)}
              aria-describedby={alert ? `${id}-alert` : undefined}
              aria-invalid={alert ? true : undefined}
            />
          </div>
          {kind === "rate_change" ? (
            <div className="grid gap-2">
              <Label htmlFor={`${id}-rate`}>Tasa anual %</Label>
              <Input
                id={`${id}-rate`}
                inputMode="decimal"
                required
                autoComplete="off"
                value={fields.rate}
                onChange={(event) => set("rate")(event.target.value)}
              />
            </div>
          ) : (
            <div className="grid gap-2">
              <Label htmlFor={`${id}-amount`}>
                {kind === "payment" ? `Monto (${unit})` : `Saldo (${unit})`}
              </Label>
              <Input
                id={`${id}-amount`}
                inputMode="decimal"
                required
                autoComplete="off"
                value={fields.amount}
                onChange={(event) => set("amount")(event.target.value)}
              />
            </div>
          )}
        </div>
        {kind === "payment" && (
          <>
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor={`${id}-settles`}>Cancela la deuda</Label>
              <Switch
                id={`${id}-settles`}
                checked={fields.settles}
                onCheckedChange={set("settles")}
              />
            </div>
            {cash === null ? (
              <p className="text-muted-foreground text-xs">{cashNote}</p>
            ) : (
              <>
                <div className="grid gap-2">
                  <Label htmlFor={`${id}-cash`}>Desde qué cuenta</Label>
                  <Select
                    value={fields.cashHoldingId || NO_ACCOUNT}
                    onValueChange={(value) => {
                      const holding = value === NO_ACCOUNT ? "" : value;
                      setFields((current) => ({
                        ...current,
                        cashHoldingId: holding,
                        take: holding === "" ? false : current.take,
                      }));
                      setAlert(undefined);
                    }}
                  >
                    <SelectTrigger id={`${id}-cash`} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_ACCOUNT}>Ninguna</SelectItem>
                      {cash.map((each) => (
                        <SelectItem key={each.id} value={each.id}>
                          {`${each.label} · ${formatAmount(each.amount, each.currency)}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {chosen && (
                  <div className="flex items-center justify-between gap-4">
                    <Label htmlFor={`${id}-take`}>
                      Descontar ahora de la cuenta
                    </Label>
                    <Switch
                      id={`${id}-take`}
                      checked={fields.take}
                      onCheckedChange={set("take")}
                    />
                  </div>
                )}
              </>
            )}
          </>
        )}
        {alert && <FormAlert id={`${id}-alert`}>{alert}</FormAlert>}
        <DialogActions
          submitLabel={mode === "create" ? "Registrar" : "Guardar"}
          describedBy={alert ? `${id}-alert` : undefined}
        />
      </form>
    </AppDialog>
  );
}
