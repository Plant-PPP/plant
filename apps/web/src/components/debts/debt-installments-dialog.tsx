"use client";

import {
  type Installment,
  installmentSchema,
  INSTALLMENTS_MAX,
  installmentSeries,
} from "@plant/core";
import { CalendarClock, Plus, Trash2 } from "lucide-react";
import { useId, useRef, useState } from "react";

import { useSavedFocus } from "@/components/portfolio-setup/saved-focus";
import { AppDialog } from "@/components/ui/app-dialog";
import { Button } from "@/components/ui/button";
import { DialogActions } from "@/components/ui/dialog-actions";
import { FormAlert } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { amountInput, parseAmountInput } from "@/lib/format/amount";

type Row = { key: number; date: string; amount: string };

export const INSTALLMENTS_INVALID =
  "Revisá las cuotas: cada una necesita fecha y un monto mayor a 0.";
const SERIES_INVALID =
  "Completá desde cuándo, cuántas cuotas, cada cuántos meses y el monto.";
const TOO_MANY = `Un plan tiene hasta ${INSTALLMENTS_MAX} cuotas.`;

// The rows as installments, or null when one is not valid.
export function rowsToInstallments(
  rows: readonly Pick<Row, "date" | "amount">[],
): Installment[] | null {
  const installments: Installment[] = [];
  for (const row of rows) {
    const parsed = installmentSchema.safeParse({
      due_on: row.date,
      amount: parseAmountInput(row.amount),
    });
    if (!parsed.success) return null;
    installments.push(parsed.data);
  }
  return installments;
}

// Edits a debt's installment plan: one row per installment, date and amount,
// and a helper that adds several equal ones a number of months apart. It
// hands the plan to `onSubmit` as it closes.
export function DebtInstallmentsDialog({
  initial,
  initialError,
  unit,
  returnFocusTo,
  onClose,
  onSubmit,
}: {
  initial: readonly Installment[];
  initialError?: string;
  // The debt's unit, as amounts are typed in it.
  unit: string;
  returnFocusTo: () => HTMLElement | null;
  onClose: () => void;
  onSubmit: (installments: Installment[]) => boolean;
}) {
  const id = useId();
  const next = useRef(initial.length);
  const [rows, setRows] = useState<Row[]>(() =>
    initial.map((each, key) => ({
      key,
      date: each.due_on,
      amount: amountInput(each.amount),
    })),
  );
  const [series, setSeries] = useState({
    start: "",
    count: "",
    every: "1",
    amount: "",
  });
  const [alert, setAlert] = useState(initialError);
  const focus = useSavedFocus(returnFocusTo, false);

  const add = (added: { date: string; amount: string }[]) => {
    if (rows.length + added.length > INSTALLMENTS_MAX) {
      setAlert(TOO_MANY);
      return;
    }
    setRows((current) => [
      ...current,
      ...added.map((each) => ({ ...each, key: next.current++ })),
    ]);
    setAlert(undefined);
  };

  const setRow = (key: number, field: "date" | "amount", value: string) => {
    setRows((current) =>
      current.map((row) =>
        row.key === key ? { ...row, [field]: value } : row,
      ),
    );
    setAlert(undefined);
  };

  function addSeries() {
    const count = Number(series.count);
    const every = Number(series.every);
    const amount = parseAmountInput(series.amount);
    if (
      !installmentSchema.shape.due_on.safeParse(series.start).success ||
      !Number.isInteger(count) ||
      count < 1 ||
      !Number.isInteger(every) ||
      every < 1 ||
      every > 120 ||
      amount === null
    ) {
      setAlert(SERIES_INVALID);
      return;
    }
    if (rows.length + count > INSTALLMENTS_MAX) {
      setAlert(TOO_MANY);
      return;
    }
    add(
      installmentSeries(series.start, count, every, amount).map((each) => ({
        date: each.due_on,
        amount: series.amount,
      })),
    );
    setSeries({ start: "", count: "", every: series.every, amount: "" });
  }

  function submit() {
    const installments = rowsToInstallments(rows);
    if (installments === null) {
      setAlert(INSTALLMENTS_INVALID);
      return;
    }
    if (!onSubmit(installments)) return;
    focus.markSaved();
    onClose();
  }

  return (
    <AppDialog
      onClose={onClose}
      title="Plan de cuotas"
      description="Cada cuota que te queda, con su fecha y su monto. Los pagos que registrás las van cubriendo en orden."
      icon={CalendarClock}
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
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            Todavía no cargaste cuotas.
          </p>
        ) : (
          <ul className="grid max-h-72 gap-2 overflow-y-auto">
            {rows.map((row, index) => (
              <li
                key={row.key}
                className="grid grid-cols-[1fr_1fr_auto] items-center gap-2"
              >
                <Input
                  type="date"
                  aria-label={`Fecha de la cuota ${index + 1}`}
                  value={row.date}
                  onChange={(event) =>
                    setRow(row.key, "date", event.target.value)
                  }
                />
                <Input
                  inputMode="decimal"
                  autoComplete="off"
                  aria-label={`Monto de la cuota ${index + 1} (${unit})`}
                  value={row.amount}
                  onChange={(event) =>
                    setRow(row.key, "amount", event.target.value)
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Quitar la cuota ${index + 1}`}
                  onClick={() =>
                    setRows((current) =>
                      current.filter((each) => each.key !== row.key),
                    )
                  }
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="justify-self-start"
          onClick={() => add([{ date: "", amount: "" }])}
        >
          <Plus />
          Agregar cuota
        </Button>
        <fieldset className="grid gap-2 rounded-md border p-3">
          <legend className="px-1 text-xs font-medium">Agregar varias</legend>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <Label htmlFor={`${id}-start`}>Primera</Label>
              <Input
                id={`${id}-start`}
                type="date"
                value={series.start}
                onChange={(event) =>
                  setSeries({ ...series, start: event.target.value })
                }
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor={`${id}-amount`}>{`Monto (${unit})`}</Label>
              <Input
                id={`${id}-amount`}
                inputMode="decimal"
                autoComplete="off"
                value={series.amount}
                onChange={(event) =>
                  setSeries({ ...series, amount: event.target.value })
                }
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor={`${id}-count`}>Cantidad</Label>
              <Input
                id={`${id}-count`}
                inputMode="numeric"
                autoComplete="off"
                value={series.count}
                onChange={(event) =>
                  setSeries({ ...series, count: event.target.value })
                }
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor={`${id}-every`}>Cada cuántos meses</Label>
              <Input
                id={`${id}-every`}
                inputMode="numeric"
                autoComplete="off"
                value={series.every}
                onChange={(event) =>
                  setSeries({ ...series, every: event.target.value })
                }
              />
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="justify-self-start"
            onClick={addSeries}
          >
            <Plus />
            Agregar varias
          </Button>
        </fieldset>
        {alert && <FormAlert id={`${id}-alert`}>{alert}</FormAlert>}
        <DialogActions
          submitLabel="Guardar"
          describedBy={alert ? `${id}-alert` : undefined}
        />
      </form>
    </AppDialog>
  );
}
