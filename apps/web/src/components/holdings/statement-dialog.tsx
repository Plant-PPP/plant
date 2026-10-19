"use client";

import { FileSpreadsheet } from "lucide-react";
import { useId, useState, useTransition } from "react";

import { useSavedFocus } from "@/components/portfolio-setup/saved-focus";
import { AppDialog } from "@/components/ui/app-dialog";
import { DialogActions } from "@/components/ui/dialog-actions";
import { FormAlert } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { StatementResult, StatementSummary } from "@/lib/cash/input";
import { STATEMENT_MESSAGES } from "@/lib/cash/messages";
import { formatAmount } from "@/lib/format/amount";
import { formatDate } from "@/lib/format/date";
import { CURRENCY_LABELS } from "@/lib/holdings/messages";
import { FAILED } from "@/lib/portfolio-setup/messages";
import { settle } from "@/lib/server-action-call";

const plural = (count: number, one: string, many: string) =>
  `${count.toLocaleString("es-AR")} ${count === 1 ? one : many}`;

// What a statement would write, line by line.
function summaryLines(summary: StatementSummary): string[] {
  return [
    ...(summary.from && summary.to
      ? [`Del ${formatDate(summary.from)} al ${formatDate(summary.to)}.`]
      : []),
    `${plural(summary.matched, "operación ya cargada", "operaciones ya cargadas")} y ${plural(summary.created, "nueva", "nuevas")}.`,
    ...summary.cash.map(
      (each) =>
        `${CURRENCY_LABELS[each.currency]}: ${plural(each.count, "movimiento", "movimientos")}${
          each.opening === null
            ? ""
            : `, con un saldo inicial de ${formatAmount(each.opening, each.currency)}`
        }.`,
    ),
    ...(summary.known > 0
      ? [
          `${plural(summary.known, "fila ya estaba", "filas ya estaban")} en el efectivo.`,
        ]
      : []),
    ...(summary.skipped > 0
      ? [
          `${plural(summary.skipped, "fila queda", "filas quedan")} afuera: sin terminar o de un activo que no conocemos.`,
        ]
      : []),
  ];
}

// Imports a broker's export of an account's movements: it reads the file
// first and shows what it would write, then writes it once confirmed.
export function StatementDialog({
  load,
  returnFocusTo,
  onClose,
  onDone,
}: {
  load: (
    file: { fileName: string; text: string },
    confirm: boolean,
  ) => Promise<StatementResult>;
  returnFocusTo: () => HTMLElement | null;
  onClose: () => void;
  onDone: (summary: StatementSummary) => void;
}) {
  const id = useId();
  const alertId = `${id}-alert`;
  const focus = useSavedFocus(returnFocusTo, false);
  const [file, setFile] = useState<{ fileName: string; text: string } | null>(
    null,
  );
  const [summary, setSummary] = useState<StatementSummary | null>(null);
  const [alert, setAlert] = useState<string>();
  const [pending, startTransition] = useTransition();

  const answer = (result: StatementResult | "rejected") =>
    result === "rejected"
      ? { summary: null, alert: FAILED }
      : result.ok
        ? { summary: result.summary, alert: undefined }
        : {
            summary: result.summary ?? null,
            alert: STATEMENT_MESSAGES[result.code],
          };

  function choose(chosen: File | undefined) {
    setSummary(null);
    setAlert(undefined);
    if (!chosen) return;
    startTransition(async () => {
      const read = { fileName: chosen.name, text: await chosen.text() };
      setFile(read);
      const shown = answer(await settle(load(read, false)));
      startTransition(() => {
        setSummary(shown.summary);
        setAlert(shown.alert);
      });
    });
  }

  function submit() {
    if (!file || !summary || alert) return;
    startTransition(async () => {
      const result = await settle(load(file, true));
      const shown = answer(result);
      startTransition(() => {
        if (result !== "rejected" && result.ok) {
          focus.markSaved();
          onDone(result.summary);
          onClose();
          return;
        }
        setSummary(shown.summary);
        setAlert(shown.alert);
      });
    });
  }

  return (
    <AppDialog
      onClose={onClose}
      title="Importar movimientos de la cuenta"
      icon={FileSpreadsheet}
      description="Subí los Movimientos históricos que exporta IOL. Leemos depósitos, extracciones, compras, ventas y dividendos de pesos y dólares; lo que ya está cargado no se repite."
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
        <div className="grid gap-2">
          <Label htmlFor={`${id}-file`}>Archivo</Label>
          <Input
            id={`${id}-file`}
            type="file"
            accept=".xls,.html,.htm"
            disabled={pending}
            aria-describedby={alert ? alertId : undefined}
            onChange={(event) => choose(event.target.files?.[0])}
          />
        </div>
        {summary && (
          <ul className="text-muted-foreground grid gap-1 text-xs">
            {summaryLines(summary).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
        {alert && <FormAlert id={alertId}>{alert}</FormAlert>}
        <DialogActions
          submitLabel="Importar"
          pending={pending}
          disabled={!summary || alert !== undefined}
          describedBy={alert ? alertId : undefined}
        />
      </form>
    </AppDialog>
  );
}
