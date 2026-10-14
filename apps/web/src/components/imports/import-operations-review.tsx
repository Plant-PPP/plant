"use client";

import { exactUnitPrice } from "@plant/core";
import { buenosAiresDate, type Currency } from "@plant/shared";
import { ArrowLeft, RotateCcw, TriangleAlert, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { InstrumentPicker } from "@/components/holdings/instrument-picker";
import { LeftOutNotice } from "@/components/imports/left-out-notice";
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
import { amountInput, parseAmountInput } from "@/lib/format/amount";
import { countOf } from "@/lib/format/text";
import { instrumentLabel, instrumentNames } from "@/lib/holdings/holding-name";
import {
  CURRENCY_LABELS,
  MOVEMENT_KIND_LABELS,
  MOVEMENT_MESSAGES,
} from "@/lib/holdings/messages";
import type { MovementResult } from "@/lib/holdings/movements-input";
import { priceBasisLabel } from "@/lib/holdings/price-input";
import type { InstrumentRow } from "@/lib/holdings/read";
import {
  type MissingField,
  missingFields,
  operationsComplete,
} from "@/lib/imports/operations-review";
import {
  CONFIDENCE_LABELS,
  type ImportItem,
  type ImportOperationKind,
  type ImportOperationRow,
} from "@/lib/imports/review";
import { settle } from "@/lib/server-action-call";
import { cn } from "@/lib/utils";

export type OperationsReviewActions = {
  confirm: (
    id: string,
    rows: ImportOperationRow[],
  ) => Promise<MovementResult & { rowId?: string }>;
};

const KINDS: ImportOperationKind[] = ["purchase", "sale", "dividend", "coupon"];

// What a refusal means for an operation read from a document.
const MESSAGES = {
  ...MOVEMENT_MESSAGES,
  not_found: "No tenías ese activo en la cuenta en esa fecha.",
  oversold:
    "Esa venta saca más unidades de las que tenías en la cuenta en esa fecha.",
} as const;

// An operation as the user completes it: its figures as typed.
type EditedOperation = ImportOperationRow & {
  quantityText: string;
  priceText: string;
  amountText: string;
  chargesText: string;
  // Whether the user chooses its instrument: the reading named none Plant
  // knows.
  picks: boolean;
};

const edited = (row: ImportOperationRow): EditedOperation => ({
  ...row,
  quantityText: row.quantity === null ? "" : amountInput(row.quantity),
  priceText: row.price === null ? "" : amountInput(row.price),
  amountText: row.amount === null ? "" : amountInput(row.amount),
  chargesText: row.charges === null ? "" : amountInput(row.charges),
  picks: row.symbol === "",
});

// The operation as it would be saved: a figure that is not a number is
// missing.
const finalOf = (row: EditedOperation): ImportOperationRow => ({
  id: row.id,
  date: row.date,
  kind: row.kind,
  symbol: row.symbol,
  quantity: parseAmountInput(row.quantityText),
  price: parseAmountInput(row.priceText),
  amount: parseAmountInput(row.amountText),
  charges: parseAmountInput(row.chargesText),
  reference: row.reference,
  currency: row.currency,
  confidence: row.confidence,
  source: row.source,
  discarded: row.discarded,
});

const MISSING = "Falta en el documento";
const NOT_A_NUMBER = "Ingresá un número válido";

type FigureField = "quantity" | "price" | "amount" | "charges";

// The figures typed that do not read as a number, and a bond's price per 100
// that a price per unit cannot hold exactly: they are asked again, never
// dropped.
function typedInvalid(
  row: EditedOperation,
  type: Parameters<typeof exactUnitPrice>[0] | undefined,
): Set<FigureField> {
  const invalid = new Set<FigureField>();
  if (row.discarded) return invalid;
  // Only the figures the kind shows: a trade's units and price, an income's
  // amount, and the charges.
  const trade = row.kind === "purchase" || row.kind === "sale";
  const income = row.kind === "dividend" || row.kind === "coupon";
  const texts: Partial<Record<FigureField, string>> = {
    ...(trade && { quantity: row.quantityText, price: row.priceText }),
    ...(income && { amount: row.amountText }),
    charges: row.chargesText,
  };
  for (const figure of Object.keys(texts) as FigureField[]) {
    if (
      texts[figure]!.trim() !== "" &&
      parseAmountInput(texts[figure]!) === null
    ) {
      invalid.add(figure);
    }
  }
  const price = trade ? parseAmountInput(row.priceText) : null;
  if (price !== null && type && exactUnitPrice(type, price) === null) {
    invalid.add("price");
  }
  return invalid;
}

// What the reading made of a document of operations, for the user to
// complete before it goes into the account: every operation with what the
// document does not say asked for, and nothing confirmed until each kept one
// is complete.
export function ImportOperationsReview({
  item,
  institution,
  instruments,
  backHref,
  doneHref,
  actions,
}: {
  item: ImportItem;
  institution: string;
  instruments: InstrumentRow[];
  backHref: string;
  doneHref: string;
  actions: OperationsReviewActions;
}) {
  const router = useRouter();
  const pickerId = useId();
  const today = buenosAiresDate(new Date());
  const names = instrumentNames(instruments);
  const types = new Map(instruments.map((each) => [each.symbol, each.type]));
  const [rows, setRows] = useState(() => (item.operations ?? []).map(edited));
  const [alert, setAlert] = useState<string>();
  const [refused, setRefused] = useState<string>();
  const [pending, startTransition] = useTransition();

  const finals = rows.map(finalOf);
  const missing = finals.map((row) => new Set(missingFields(row, today)));
  const invalidTyped = rows.map((row) =>
    typedInvalid(row, types.get(row.symbol)),
  );
  const incomplete = missing.filter(
    (each, index) => each.size > 0 || invalidTyped[index]!.size > 0,
  ).length;
  const loadedCount = rows.filter((row) => row.loaded).length;
  const doubtful = rows.filter(
    (row) => !row.discarded && row.confidence === "low",
  ).length;
  const kept = finals.some((row) => !row.discarded);
  const complete =
    operationsComplete(finals, today) &&
    invalidTyped.every((each) => each.size === 0);

  const change = (id: string, patch: Partial<EditedOperation>) => {
    setRefused(undefined);
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    );
  };

  function confirm() {
    if (!complete) return;
    setAlert(undefined);
    startTransition(async () => {
      const result = await settle(actions.confirm(item.id, finals));
      if (result !== "rejected" && result.ok) {
        const kept = finals.filter((row) => !row.discarded).length;
        toast.success(
          `Guardaste ${countOf(kept, "operación", "operaciones")} de ${item.fileName} en ${institution}`,
        );
        router.push(doneHref);
        return;
      }
      if (result === "rejected") {
        setAlert(MESSAGES.failed);
        return;
      }
      const at = rows.findIndex((row) => row.id === result.rowId);
      setRefused(result.rowId);
      if (at === -1) {
        // Refused before any operation: the import is no longer ready.
        setAlert(
          result.code === "not_found"
            ? "Esta carga ya no está lista para confirmar. Volvé a Cargar."
            : MOVEMENT_MESSAGES[result.code],
        );
        return;
      }
      setAlert(`En la operación ${at + 1}: ${MESSAGES[result.code]}`);
    });
  }

  const invalid = (index: number, field: MissingField) =>
    missing[index]!.has(field) || undefined;
  // What a figure's field says is wrong with it, if anything.
  const problem = (index: number, figure: FigureField) =>
    rows[index]!.discarded
      ? undefined
      : invalidTyped[index]!.has(figure)
        ? NOT_A_NUMBER
        : figure !== "charges" && missing[index]!.has(figure)
          ? MISSING
          : undefined;

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
          <h1 className="text-xl font-semibold">
            Revisá las operaciones que leímos
          </h1>
          <p className="text-muted-foreground text-sm">
            {`${item.fileName} · ${institution}`}
          </p>
        </div>
      </div>

      {item.skippedRows > 0 && (
        <LeftOutNotice>
          {item.skippedRows === 1
            ? "Una operación quedó afuera: revisala en el broker antes de confirmar."
            : `${item.skippedRows} operaciones quedaron afuera: revisalas en el broker antes de confirmar.`}
        </LeftOutNotice>
      )}

      <section className="grid gap-3" aria-labelledby={`${pickerId}-list`}>
        <div className="flex flex-wrap items-center gap-2">
          <h2 id={`${pickerId}-list`} className="text-base font-semibold">
            {countOf(rows.length, "operación", "operaciones")}
          </h2>
          {incomplete > 0 && (
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-800 dark:text-amber-200">
              {`${incomplete} con datos faltantes`}
            </span>
          )}
          {loadedCount > 0 && (
            <span className="text-muted-foreground text-xs">
              {loadedCount === 1
                ? "1 ya estaba cargada"
                : `${loadedCount} ya estaban cargadas`}
            </span>
          )}
          {doubtful > 0 && (
            <span className="text-muted-foreground text-xs">
              {countOf(doubtful, "dudosa", "dudosas")}
            </span>
          )}
        </div>
        <ul className="grid gap-2">
          {rows.map((row, index) => {
            const type = types.get(row.symbol);
            const trade = row.kind === "purchase" || row.kind === "sale";
            return (
              <li
                key={row.id}
                aria-label={`Operación ${index + 1}`}
                className={cn(
                  "grid gap-3 rounded-lg border p-3",
                  !row.discarded &&
                    (missing[index]!.size > 0 || row.confidence === "low") &&
                    "border-amber-500/60 bg-amber-500/5",
                  refused === row.id && "border-destructive",
                  row.discarded && "opacity-50",
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="grid min-w-0 gap-1">
                    {row.picks ? (
                      <InstrumentPicker
                        id={`${pickerId}-${row.id}`}
                        aria-label={`Activo de la operación ${index + 1}`}
                        aria-invalid={invalid(index, "symbol")}
                        instruments={instruments}
                        value={row.symbol}
                        onChange={(symbol) => change(row.id, { symbol })}
                        placeholder="Elegí un activo"
                      />
                    ) : (
                      <span className="truncate font-medium">
                        {instrumentLabel(row.symbol, names.get(row.symbol))}
                      </span>
                    )}
                    <span className="text-muted-foreground flex flex-wrap gap-x-2 text-xs">
                      <span>{row.source}</span>
                      <span>{`Confianza ${CONFIDENCE_LABELS[row.confidence].toLowerCase()}`}</span>
                      {row.reference && <span>{`N° ${row.reference}`}</span>}
                      {row.loaded && (
                        <span className="text-foreground">Ya está cargada</span>
                      )}
                    </span>
                    {!row.discarded && missing[index]!.has("symbol") && (
                      <MissingText />
                    )}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={`${row.discarded ? "Recuperar" : "Descartar"} la operación ${index + 1}`}
                    onClick={() =>
                      change(row.id, { discarded: !row.discarded })
                    }
                  >
                    {row.discarded ? <RotateCcw /> : <X />}
                    {row.discarded ? "Recuperar" : "Descartar"}
                  </Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="grid gap-1 text-xs">
                    <span className="text-muted-foreground">Tipo</span>
                    <Select
                      value={row.kind ?? ""}
                      disabled={row.discarded}
                      onValueChange={(kind) =>
                        change(row.id, { kind: kind as ImportOperationKind })
                      }
                    >
                      <SelectTrigger
                        aria-label={`Tipo de la operación ${index + 1}`}
                        aria-invalid={invalid(index, "kind")}
                      >
                        <SelectValue placeholder="Elegí el tipo" />
                      </SelectTrigger>
                      <SelectContent>
                        {KINDS.map((kind) => (
                          <SelectItem key={kind} value={kind}>
                            {MOVEMENT_KIND_LABELS[kind]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {!row.discarded && missing[index]!.has("kind") && (
                      <MissingText />
                    )}
                  </label>
                  <label className="grid gap-1 text-xs">
                    <span className="text-muted-foreground">Fecha</span>
                    <Input
                      type="date"
                      max={today}
                      value={row.date ?? ""}
                      aria-label={`Fecha de la operación ${index + 1}`}
                      aria-invalid={invalid(index, "date")}
                      disabled={row.discarded}
                      onChange={(event) =>
                        change(row.id, { date: event.target.value || null })
                      }
                    />
                    {!row.discarded && missing[index]!.has("date") && (
                      <MissingText />
                    )}
                  </label>
                  <label className="grid gap-1 text-xs">
                    <span className="text-muted-foreground">Moneda</span>
                    <Select
                      value={row.currency}
                      disabled={row.discarded}
                      onValueChange={(currency) =>
                        change(row.id, { currency: currency as Currency })
                      }
                    >
                      <SelectTrigger
                        aria-label={`Moneda de la operación ${index + 1}`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(CURRENCY_LABELS) as Currency[]).map(
                          (currency) => (
                            <SelectItem key={currency} value={currency}>
                              {CURRENCY_LABELS[currency]}
                            </SelectItem>
                          ),
                        )}
                      </SelectContent>
                    </Select>
                  </label>
                </div>
                {row.kind === null ? (
                  <p className="text-muted-foreground text-xs">
                    Elegí el tipo para completar el resto.
                  </p>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-3">
                    {trade ? (
                      <>
                        <Figure
                          label="Cantidad"
                          aria={`Cantidad de la operación ${index + 1}`}
                          value={row.quantityText}
                          disabled={row.discarded}
                          problem={problem(index, "quantity")}
                          onChange={(quantityText) =>
                            change(row.id, { quantityText })
                          }
                        />
                        <Figure
                          label={
                            type
                              ? `Precio ${priceBasisLabel(type)} (${row.currency})`
                              : `Precio (${row.currency})`
                          }
                          aria={`Precio de la operación ${index + 1}`}
                          value={row.priceText}
                          disabled={row.discarded}
                          problem={problem(index, "price")}
                          onChange={(priceText) =>
                            change(row.id, { priceText })
                          }
                        />
                      </>
                    ) : (
                      <Figure
                        label={`Monto (${row.currency})`}
                        aria={`Monto de la operación ${index + 1}`}
                        value={row.amountText}
                        disabled={row.discarded}
                        problem={problem(index, "amount")}
                        onChange={(amountText) =>
                          change(row.id, { amountText })
                        }
                      />
                    )}
                    <Figure
                      label={`Gastos (${row.currency}) · Opcional`}
                      aria={`Gastos de la operación ${index + 1}`}
                      value={row.chargesText}
                      disabled={row.discarded}
                      problem={problem(index, "charges")}
                      onChange={(chargesText) =>
                        change(row.id, { chargesText })
                      }
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {alert && <FormAlert>{alert}</FormAlert>}

      <div className="flex flex-wrap items-center justify-end gap-3">
        {!complete && (
          <span className="text-muted-foreground text-xs">
            {kept
              ? "Completá los datos que faltan para confirmar."
              : "Dejá al menos una operación."}
          </span>
        )}
        <Button asChild variant="ghost">
          <Link href={backHref}>Después</Link>
        </Button>
        <Button type="button" disabled={!complete || pending} onClick={confirm}>
          Confirmar operaciones
        </Button>
      </div>
    </div>
  );
}

function ProblemText({ text }: { text: string }) {
  return (
    <span className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300">
      <TriangleAlert aria-hidden className="size-3" />
      {text}
    </span>
  );
}

function MissingText() {
  return <ProblemText text={MISSING} />;
}

function Figure({
  label,
  aria,
  value,
  disabled,
  problem,
  onChange,
}: {
  label: string;
  aria: string;
  value: string;
  disabled: boolean;
  problem: string | undefined;
  onChange: (text: string) => void;
}) {
  return (
    <label className="grid gap-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <Input
        value={value}
        aria-label={aria}
        inputMode="decimal"
        disabled={disabled}
        aria-invalid={problem !== undefined || undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {problem && <ProblemText text={problem} />}
    </label>
  );
}
