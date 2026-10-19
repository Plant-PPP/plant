"use client";

import type { Currency } from "@plant/shared";
import { Banknote } from "lucide-react";
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
import { parseAmountInput } from "@/lib/format/amount";
import { type CashEntryKind, CASH_ENTRY_KINDS } from "@/lib/cash/input";
import {
  CASH_ENTRY_LABELS,
  CASH_MESSAGES,
  CURRENCY_IN_TEXT,
} from "@/lib/cash/messages";
import { CURRENCY_LABELS } from "@/lib/holdings/messages";

export type CashEntryFields = {
  kind: CashEntryKind;
  currency: Currency;
  date: string;
  amount: string;
  note: string;
};

export const CASH_CURRENCIES: readonly Currency[] = ["ARS", "USD"];

// One movement of an account's cash typed by hand: the opening balance of
// one currency (`opening`), or a deposit or a withdrawal in pesos or dollars.
// It hands its fields to `onSubmit` as it closes, and a refused write opens
// it again with them and the alert.
export function CashEntryDialog({
  initial,
  initialError,
  today,
  opening,
  returnFocusTo,
  onClose,
  onSubmit,
}: {
  initial: CashEntryFields;
  initialError?: string;
  today: string;
  // Whether it states the opening balance of the initial currency.
  opening: boolean;
  returnFocusTo: () => HTMLElement | null;
  onClose: () => void;
  onSubmit: (fields: CashEntryFields, amount: string) => boolean;
}) {
  const id = useId();
  const alertId = `${id}-alert`;
  const [fields, setFields] = useState(initial);
  const [alert, setAlert] = useState(initialError);
  const focus = useSavedFocus(returnFocusTo, false);
  const kinds = CASH_ENTRY_KINDS.filter((kind) => kind !== "opening_balance");

  function submit() {
    const amount = parseAmountInput(fields.amount);
    const zero = amount !== null && /^0(\.0+)?$/.test(amount);
    if (
      amount === null ||
      amount.startsWith("-") ||
      (zero && fields.kind !== "opening_balance")
    ) {
      setAlert(CASH_MESSAGES.invalid);
      document.getElementById(`${id}-amount`)?.focus();
      return;
    }
    if (fields.date === "" || fields.date > today) {
      setAlert(
        fields.date === "" ? CASH_MESSAGES.invalid : CASH_MESSAGES.future,
      );
      document.getElementById(`${id}-date`)?.focus();
      return;
    }
    setAlert(undefined);
    if (!onSubmit(fields, amount)) return;
    focus.markSaved();
    onClose();
  }

  const set = (patch: Partial<CashEntryFields>) => {
    setFields((current) => ({ ...current, ...patch }));
    setAlert(undefined);
  };

  return (
    <AppDialog
      onClose={onClose}
      title={
        opening
          ? `Saldo inicial en ${CURRENCY_IN_TEXT[fields.currency]}`
          : "Registrar movimiento de efectivo"
      }
      icon={Banknote}
      description={
        opening
          ? "Lo que había en la cuenta ese día, antes de todo lo que cargues después. No cuenta como plata que pusiste."
          : "Lo que pusiste o sacaste de la cuenta. Las compras, ventas y dividendos mueven el efectivo solos cuando los importás."
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
        <div className="grid grid-cols-2 gap-3">
          {!opening && (
            <>
              <div className="grid gap-2">
                <Label htmlFor={`${id}-currency`}>Moneda</Label>
                <Select
                  value={fields.currency}
                  onValueChange={(value) =>
                    set({ currency: value as Currency })
                  }
                >
                  <SelectTrigger id={`${id}-currency`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CASH_CURRENCIES.map((currency) => (
                      <SelectItem key={currency} value={currency}>
                        {CURRENCY_LABELS[currency]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor={`${id}-kind`}>Movimiento</Label>
                <Select
                  value={fields.kind}
                  onValueChange={(value) =>
                    set({ kind: value as CashEntryKind })
                  }
                >
                  <SelectTrigger id={`${id}-kind`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {kinds.map((kind) => (
                      <SelectItem key={kind} value={kind}>
                        {CASH_ENTRY_LABELS[kind]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
          <div className="grid gap-2">
            <Label htmlFor={`${id}-amount`}>Monto</Label>
            <Input
              id={`${id}-amount`}
              inputMode="decimal"
              autoComplete="off"
              autoFocus
              required
              aria-describedby={alert ? alertId : undefined}
              value={fields.amount}
              onChange={(event) => set({ amount: event.target.value })}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${id}-date`}>Fecha</Label>
            <Input
              id={`${id}-date`}
              type="date"
              max={today}
              required
              value={fields.date}
              onChange={(event) => set({ date: event.target.value })}
            />
          </div>
        </div>
        {!opening && (
          <div className="grid gap-2">
            <Label htmlFor={`${id}-note`}>Nota (opcional)</Label>
            <Input
              id={`${id}-note`}
              autoComplete="off"
              maxLength={200}
              value={fields.note}
              onChange={(event) => set({ note: event.target.value })}
            />
          </div>
        )}
        {alert && <FormAlert id={alertId}>{alert}</FormAlert>}
        <DialogActions
          submitLabel="Guardar"
          describedBy={alert ? alertId : undefined}
        />
      </form>
    </AppDialog>
  );
}
