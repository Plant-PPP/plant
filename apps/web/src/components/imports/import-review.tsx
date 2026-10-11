"use client";

import { exactOf, times, toDecimal } from "@plant/shared";
import {
  ArrowLeft,
  Check,
  Plus,
  RotateCcw,
  TriangleAlert,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  amountInput,
  formatAmount,
  formatQuantity,
  parseAmountInput,
} from "@/lib/format/amount";
import { formatDate } from "@/lib/format/date";
import { MOVEMENT_MESSAGES } from "@/lib/holdings/messages";
import type { MovementResult } from "@/lib/holdings/movements-input";
import type { InstrumentRow } from "@/lib/holdings/read";
import {
  CONFIDENCE_LABELS,
  type ImportItem,
  type ImportRow,
  readTotals,
  rowChange,
  totalsMatch,
} from "@/lib/imports/review";
import { settle } from "@/lib/server-action-call";
import { cn } from "@/lib/utils";

export type ReviewActions = {
  confirm: (id: string, rows: ImportRow[]) => Promise<MovementResult>;
};

// A row as the user edits it: the quantity and price as typed.
type EditedRow = ImportRow & { quantityText: string; priceText: string };

const edited = (row: ImportRow): EditedRow => ({
  ...row,
  quantityText: amountInput(row.quantity),
  priceText: row.price === null ? "" : amountInput(row.price),
});

const CHANGE_TEXT = {
  new: "Nueva",
  same: "Sin cambios",
  discarded: "Descartada",
} as const;

// What the reading made of a document, to correct, discard or add to before
// it goes into the account: each row with how sure the reading is and where
// it was read, what it changes in the account, and the totals read against
// the ones the document prints.
export function ImportReview({
  item,
  institution,
  instruments,
  held,
  backHref,
  doneHref,
  actions,
}: {
  item: ImportItem;
  institution: string;
  instruments: InstrumentRow[];
  // What the account holds of each instrument now.
  held: ReadonlyMap<string, string>;
  backHref: string;
  doneHref: string;
  actions: ReviewActions;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(() => item.rows.map(edited));
  const [alert, setAlert] = useState<string>();
  const [pending, startTransition] = useTransition();
  const names = new Map(instruments.map((each) => [each.symbol, each.name]));

  // The rows as they would be saved; null where a typed value is not a number.
  const parsed = rows.map((row) => {
    const quantity = parseAmountInput(row.quantityText);
    const price =
      row.priceText.trim() === "" ? null : parseAmountInput(row.priceText);
    return { row, quantity, price };
  });
  const valid = parsed.every(
    ({ row, quantity, price }) =>
      row.discarded ||
      (quantity !== null &&
        exactOf(quantity).n > 0n &&
        row.symbol !== "" &&
        (row.priceText.trim() === "" || price !== null)),
  );
  const finalRows: ImportRow[] = parsed.map(({ row, quantity, price }) => ({
    id: row.id,
    symbol: row.symbol,
    quantity: quantity ?? "0",
    price,
    currency: row.currency,
    confidence: row.confidence,
    source: row.source,
    discarded: row.discarded,
  }));
  const totals = readTotals(finalRows);
  const matches = totalsMatch(totals, item.documentTotals);
  const doubtful = rows.filter(
    (row) => !row.discarded && row.confidence === "low",
  ).length;

  const change = (id: string, patch: Partial<EditedRow>) =>
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    );

  function confirm() {
    if (!valid) {
      setAlert(
        "Revisá las filas: cada una necesita un activo y una cantidad mayor a 0.",
      );
      return;
    }
    setAlert(undefined);
    startTransition(async () => {
      const result = await settle(actions.confirm(item.id, finalRows));
      if (result !== "rejected" && result.ok) {
        toast.success(`Guardaste lo de ${item.fileName} en ${institution}`);
        router.push(doneHref);
        return;
      }
      setAlert(
        result === "rejected"
          ? MOVEMENT_MESSAGES.failed
          : MOVEMENT_MESSAGES[result.code],
      );
    });
  }

  return (
    <div className="grid gap-6">
      <div className="grid gap-3">
        <Link
          href={backHref}
          className="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1 text-sm"
        >
          <ArrowLeft aria-hidden className="size-4" />
          Cargar
        </Link>
        <div className="grid gap-1">
          <h1 className="text-xl font-semibold">Revisá lo que leímos</h1>
          <p className="text-muted-foreground text-sm">
            {`${item.fileName} · ${institution}`}
            {item.documentDate && ` · al ${formatDate(item.documentDate)}`}
          </p>
        </div>
      </div>

      <section
        className={cn(
          "grid gap-2 rounded-lg border p-4",
          matches ? "border-emerald-600/40" : "border-amber-500/50",
        )}
        aria-label="Totales"
      >
        <p className="flex items-center gap-2 text-sm font-medium">
          {matches ? (
            <Check aria-hidden className="size-4 text-emerald-600" />
          ) : (
            <TriangleAlert aria-hidden className="size-4 text-amber-600" />
          )}
          {matches
            ? "Lo leído suma lo mismo que el documento."
            : "Lo leído no suma lo mismo que el documento: revisá las filas dudosas."}
        </p>
        <dl className="grid grid-cols-[auto_auto_auto] justify-start gap-x-6 gap-y-1 text-sm tabular-nums">
          <dt className="text-muted-foreground text-xs">Moneda</dt>
          <dt className="text-muted-foreground text-xs">Leído</dt>
          <dt className="text-muted-foreground text-xs">Documento</dt>
          {item.documentTotals.map((total) => (
            <div key={total.currency} className="contents">
              <dd>{total.currency}</dd>
              <dd>
                {formatAmount(
                  totals.find((each) => each.currency === total.currency)
                    ?.amount ?? "0",
                  total.currency,
                )}
              </dd>
              <dd>{formatAmount(total.amount, total.currency)}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">
            {`${rows.filter((row) => !row.discarded).length} tenencias`}
            {doubtful > 0 && (
              <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-xs font-normal text-amber-700 dark:text-amber-300">
                {doubtful === 1 ? "1 dudosa" : `${doubtful} dudosas`}
              </span>
            )}
          </h2>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              setRows((current) => [
                ...current,
                edited({
                  id: `added-${current.length}`,
                  symbol: "",
                  quantity: "0",
                  price: null,
                  currency: "ARS",
                  confidence: "high",
                  source: "Agregada por vos",
                  discarded: false,
                }),
              ])
            }
          >
            <Plus />
            Agregar fila
          </Button>
        </div>
        <ul className="grid gap-2">
          {rows.map((row, index) => {
            const { quantity, price } = parsed[index]!;
            const effect = rowChange(
              { quantity: quantity ?? "0", discarded: row.discarded },
              held.get(row.symbol),
            );
            const value =
              quantity && price
                ? toDecimal(times(exactOf(quantity), exactOf(price)), 2)
                : null;
            return (
              <li
                key={row.id}
                className={cn(
                  "grid gap-3 rounded-lg border p-3 @container sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end",
                  row.confidence === "low" &&
                    !row.discarded &&
                    "border-amber-500/60 bg-amber-500/5",
                  row.discarded && "opacity-50",
                )}
              >
                <div className="grid min-w-0 gap-1">
                  {row.source === "Agregada por vos" ? (
                    <Select
                      value={row.symbol}
                      onValueChange={(symbol) => {
                        if (!symbol) return;
                        change(row.id, {
                          symbol,
                          currency:
                            instruments.find((each) => each.symbol === symbol)
                              ?.currency ?? "ARS",
                        });
                      }}
                    >
                      <SelectTrigger
                        className="w-full"
                        aria-label={`Activo de la fila ${index + 1}`}
                      >
                        <SelectValue placeholder="Elegí un activo" />
                      </SelectTrigger>
                      <SelectContent>
                        {instruments.map((each) => (
                          <SelectItem key={each.symbol} value={each.symbol}>
                            {`${each.symbol} · ${each.name}`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <span className="truncate font-medium">
                      {`${row.symbol} · ${names.get(row.symbol) ?? row.symbol}`}
                    </span>
                  )}
                  <span className="text-muted-foreground flex flex-wrap gap-x-2 text-xs">
                    <span>{row.source}</span>
                    <span>{`Confianza ${CONFIDENCE_LABELS[row.confidence].toLowerCase()}`}</span>
                    <span className="text-foreground">
                      {effect.kind === "up" || effect.kind === "down"
                        ? `${effect.kind === "up" ? "Sube" : "Baja"} de ${formatQuantity(effect.held)}`
                        : CHANGE_TEXT[effect.kind]}
                    </span>
                  </span>
                </div>
                <label className="grid gap-1 text-xs">
                  <span className="text-muted-foreground">Cantidad</span>
                  <Input
                    value={row.quantityText}
                    aria-label={`Cantidad de la fila ${index + 1}`}
                    inputMode="decimal"
                    disabled={row.discarded}
                    aria-invalid={
                      !row.discarded &&
                      (quantity === null || exactOf(quantity).n <= 0n)
                    }
                    onChange={(event) =>
                      change(row.id, { quantityText: event.target.value })
                    }
                  />
                </label>
                <label className="grid gap-1 text-xs">
                  <span className="text-muted-foreground">
                    {`Precio (${row.currency})`}
                    {value && (
                      <span className="text-foreground ml-1 tabular-nums">
                        {`· ${formatAmount(value, row.currency)}`}
                      </span>
                    )}
                  </span>
                  <Input
                    value={row.priceText}
                    aria-label={`Precio de la fila ${index + 1}`}
                    inputMode="decimal"
                    disabled={row.discarded}
                    onChange={(event) =>
                      change(row.id, { priceText: event.target.value })
                    }
                  />
                </label>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={`${row.discarded ? "Recuperar" : "Descartar"} la fila ${index + 1}`}
                  onClick={() => change(row.id, { discarded: !row.discarded })}
                >
                  {row.discarded ? <RotateCcw /> : <X />}
                  {row.discarded ? "Recuperar" : "Descartar"}
                </Button>
              </li>
            );
          })}
        </ul>
        <p className="text-muted-foreground text-xs">
          Lo que tenés en la cuenta y no aparece en el documento queda como
          está.
        </p>
      </section>

      {alert && <FormAlert>{alert}</FormAlert>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href={backHref}>Después</Link>
        </Button>
        <Button type="button" size="sm" disabled={pending} onClick={confirm}>
          <Check />
          Confirmar carga
        </Button>
      </div>
    </div>
  );
}
