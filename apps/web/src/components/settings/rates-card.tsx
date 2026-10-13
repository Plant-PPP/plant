"use client";

import type { ManualRateKind } from "@plant/core";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";

import { AppDialog } from "@/components/ui/app-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DialogFooter } from "@/components/ui/dialog";
import { FormAlert } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  amountInput,
  formatAmount,
  parseAmountInput,
} from "@/lib/format/amount";
import { formatDate } from "@/lib/format/date";

export const RATE_LABELS: Record<ManualRateKind, string> = {
  mep: "Dólar MEP",
  ccl: "Dólar CCL",
  official: "Dólar oficial",
};

// One dollar rate as the app values with it: its selling rate and date, or
// none, and whether the user stated it.
export type ShownRate = {
  kind: ManualRateKind;
  sell: string | null;
  date: string | null;
  manual: boolean;
};

type RateWrite = Promise<{ ok: boolean }>;

const INVALID = "Ingresá un valor mayor a cero, con coma para los decimales.";
const FUTURE = "Usá una fecha de hoy o anterior.";

// The dollar rates the app values with today, each correctable by hand: the
// user's rate beats the feeds' on its day until they bring a newer one.
export function RatesCard({
  rates,
  today,
  onSet,
  onRevert,
}: {
  rates: readonly ShownRate[];
  today: string;
  onSet: (rate: {
    kind: ManualRateKind;
    sell: string;
    date: string;
  }) => RateWrite;
  onRevert: (kind: ManualRateKind, date: string) => RateWrite;
}) {
  const [editing, setEditing] = useState<ShownRate | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const done = (text: string) => (result: { ok: boolean }) =>
    result.ok
      ? toast.success(text)
      : toast.error("No pudimos guardar. Probá de nuevo.");
  return (
    <Card>
      <CardHeader>
        <CardTitle>Dólar de hoy</CardTitle>
        <CardDescription>
          Con estas cotizaciones valuamos todo. Si una no te cierra, corregila:
          tu valor le gana a la cotización de ese día y sigue hasta que llegue
          una más nueva.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-2">
          {rates.map((rate) => (
            <li
              key={rate.kind}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
            >
              <span className="grid">
                <span className="font-medium">{RATE_LABELS[rate.kind]}</span>
                <span className="text-muted-foreground text-xs">
                  {rate.sell === null || rate.date === null
                    ? "Sin cotización"
                    : `${formatAmount(rate.sell, "ARS")} · ${
                        rate.manual ? "corregido a mano el" : "del"
                      } ${formatDate(rate.date)}`}
                </span>
              </span>
              <span className="flex gap-2">
                {rate.manual && rate.date !== null && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      void onRevert(rate.kind, rate.date!).then(
                        done(
                          `Volviste a la cotización del ${RATE_LABELS[rate.kind]}.`,
                        ),
                      )
                    }
                  >
                    Volver a la cotización
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  aria-label={`Corregir el ${RATE_LABELS[rate.kind]}`}
                  onClick={(event) => {
                    opener.current = event.currentTarget;
                    setEditing(rate);
                  }}
                >
                  Corregir
                </Button>
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
      {editing && (
        <RateDialog
          rate={editing}
          today={today}
          returnFocusTo={() => opener.current}
          onClose={() => setEditing(null)}
          onSubmit={(sell, date) =>
            void onSet({ kind: editing.kind, sell, date }).then(
              done(`Corregiste el ${RATE_LABELS[editing.kind]}.`),
            )
          }
        />
      )}
    </Card>
  );
}

// A rate as of a date, typed in pesos.
function RateDialog({
  rate,
  today,
  returnFocusTo,
  onClose,
  onSubmit,
}: {
  rate: ShownRate;
  today: string;
  returnFocusTo: () => HTMLElement | null;
  onClose: () => void;
  onSubmit: (sell: string, date: string) => void;
}) {
  const id = useId();
  const [sell, setSell] = useState(rate.sell ? amountInput(rate.sell) : "");
  const [date, setDate] = useState(today);
  const [alert, setAlert] = useState<string | null>(null);
  return (
    <AppDialog
      onClose={onClose}
      title={`Corregir el ${RATE_LABELS[rate.kind]}`}
      description="El valor de venta, en pesos por dólar."
      returnFocusTo={returnFocusTo}
    >
      <form
        className="grid gap-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          const parsed = parseAmountInput(sell);
          if (parsed === null || parsed === "0") return setAlert(INVALID);
          if (date === "" || date > today) return setAlert(FUTURE);
          onSubmit(parsed, date);
          onClose();
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-2">
            <Label htmlFor={`${id}-sell`}>Valor</Label>
            <Input
              id={`${id}-sell`}
              inputMode="decimal"
              autoComplete="off"
              aria-invalid={alert === INVALID || undefined}
              value={sell}
              onChange={(event) => setSell(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${id}-date`}>Fecha</Label>
            <Input
              id={`${id}-date`}
              type="date"
              max={today}
              aria-invalid={alert === FUTURE || undefined}
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </div>
        </div>
        {alert && <FormAlert>{alert}</FormAlert>}
        <DialogFooter>
          <Button type="submit" size="sm">
            Guardar
          </Button>
        </DialogFooter>
      </form>
    </AppDialog>
  );
}
