"use client";

import { PageCrumbs } from "@/components/layout/page-crumbs";
import { Badge } from "@/components/ui/badge";
import { exactUnitPrice, type Listing, normalizeSymbol } from "@plant/core";
import {
  buenosAiresDate,
  type Currency,
  exactOf,
  times,
  toDecimal,
} from "@plant/shared";
import { Pencil, RotateCcw, TriangleAlert, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  useCatalog,
  useInstrumentMarket,
} from "@/components/holdings/instrument-market";
import {
  type DollarLine,
  InstrumentPicker,
  lineOf,
} from "@/components/holdings/instrument-picker";
import { marketsFor } from "@/lib/instruments/markets";
import { LeftOutNotice } from "@/components/imports/left-out-notice";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  formatPrice,
  formatQuantity,
  parseAmountInput,
} from "@/lib/format/amount";
import { formatDate } from "@/lib/format/date";
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
  lackingDate,
  lackingFigure,
  missingText,
  savedToast,
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

// An operation the account already holds under the same number: confirming
// never writes it again, so the review does not offer to bring it back.
const isLocked = (row: ImportOperationRow) =>
  row.loaded === true && row.reference !== null;

const NOT_A_NUMBER = "Ingresá un número válido";

type FigureField = "quantity" | "price" | "amount" | "charges";

const FIGURE_TEXT = {
  quantity: "quantityText",
  price: "priceText",
  amount: "amountText",
  charges: "chargesText",
} as const satisfies Record<FigureField, keyof EditedOperation>;

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
  const figures: FigureField[] = [
    ...(trade ? (["quantity", "price"] as const) : []),
    ...(income ? (["amount"] as const) : []),
    "charges",
  ];
  for (const figure of figures) {
    const text = row[FIGURE_TEXT[figure]];
    if (text.trim() !== "" && parseAmountInput(text) === null) {
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
  instruments: givenInstruments,
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
  const [instruments, addToCatalog] = useCatalog(givenInstruments);
  const router = useRouter();
  const pickerId = useId();
  const today = buenosAiresDate(new Date());
  const names = instrumentNames(instruments);
  const types = new Map(instruments.map((each) => [each.symbol, each.type]));
  const [rows, setRows] = useState(() => (item.operations ?? []).map(edited));
  const [alert, setAlert] = useState<string>();
  const [refused, setRefused] = useState<string>();
  const [pending, startTransition] = useTransition();
  const [kindShown, setKindShown] = useState<ImportOperationKind | "all">(
    "all",
  );
  const [symbolShown, setSymbolShown] = useState("all");
  const [editing, setEditing] = useState<string | null>(null);
  const [attention, setAttention] = useState(
    () =>
      new Set(
        (item.operations ?? [])
          .map(edited)
          .filter((row) => {
            if (row.discarded || isLocked(row)) return false;
            return (
              row.confidence === "low" ||
              missingFields(finalOf(row), today).length > 0 ||
              typedInvalid(row, types.get(row.symbol)).size > 0
            );
          })
          .map((row) => row.id),
      ),
  );

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

  // The rows the filters show; the choices apply to these only.
  const shown = (row: EditedOperation) =>
    (kindShown === "all" || row.kind === kindShown) &&
    (symbolShown === "all" || row.symbol === symbolShown);
  const symbols = [...new Set(rows.map((row) => row.symbol))]
    .filter((symbol) => symbol !== "")
    .sort();
  const keptCount = rows.filter((row) => !row.discarded).length;
  // Each shown row kept or discarded at once; one the account already holds
  // under its number stays discarded, as confirming would drop it anyway.
  const keepShown = (keep: boolean) => {
    setRefused(undefined);
    setRows((current) =>
      current.map((row) =>
        shown(row) && !(keep && isLocked(row))
          ? { ...row, discarded: !keep }
          : row,
      ),
    );
  };

  const change = (id: string, patch: Partial<EditedOperation>) => {
    setRefused(undefined);
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    );
  };

  // An instrument the sync or the document named but the catalog lacks is
  // looked up in the market once: an exact listing is added and chosen, so
  // only what the market does not list is left to pick.
  const market = useInstrumentMarket();
  const looked = useRef(false);
  useEffect(() => {
    if (looked.current || !market) return;
    looked.current = true;
    const unknown = [
      ...new Set(
        (item.operations ?? []).flatMap((row) =>
          row.symbol === "" && row.unknownSymbol ? [row.unknownSymbol] : [],
        ),
      ),
    ];
    for (const called of unknown) {
      void (async () => {
        const found = await settle(
          market.search(called, marketsFor(institution)),
        );
        if (found === "rejected" || !found.ok) return;
        const exact = exactListing(found.listings, called);
        if (!exact) return;
        const added = await settle(
          market.add(exact.listing.symbol, exact.listing.market),
        );
        if (added === "rejected" || !added.ok) return;
        addToCatalog(added.instrument);
        const currency = exact.line ? "USD" : added.instrument.currency;
        const resolved = (row: EditedOperation) =>
          row.symbol === "" &&
          item.operations?.find((each) => each.id === row.id)?.unknownSymbol ===
            called;
        const next = (item.operations ?? [])
          .map(edited)
          .map((row) =>
            resolved(row)
              ? { ...row, symbol: added.instrument.symbol, currency }
              : row,
          );
        setRows((current) =>
          current.map((row) =>
            resolved(row)
              ? { ...row, symbol: added.instrument.symbol, currency }
              : row,
          ),
        );
        // One the market completed goes to the table with the rest.
        const done = new Set(
          next
            .filter(
              (row) =>
                row.symbol === added.instrument.symbol &&
                missingFields(finalOf(row), today).length === 0,
            )
            .map((row) => row.id),
        );
        setAttention(
          (current) => new Set([...current].filter((id) => !done.has(id))),
        );
      })();
    }
  }, [market, item.operations, institution, addToCatalog, today]);

  function confirm() {
    if (!complete) return;
    setAlert(undefined);
    startTransition(async () => {
      const result = await settle(actions.confirm(item.id, finals));
      if (result !== "rejected" && result.ok) {
        const kept = finals.filter((row) => !row.discarded).length;
        toast.success(
          savedToast(
            countOf(kept, "operación", "operaciones"),
            item,
            institution,
          ),
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
      setEditing(result.rowId ?? null);
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
  const missingCopy = missingText(item.origin);
  // What a figure's field says is wrong with it, if anything.
  const problem = (index: number, figure: FigureField) => {
    const row = rows[index]!;
    if (row.discarded) return undefined;
    if (invalidTyped[index]!.has(figure)) return NOT_A_NUMBER;
    if (figure === "charges" || !missing[index]!.has(figure)) return undefined;
    return lackingFigure(
      row[FIGURE_TEXT[figure]],
      row[figure],
      item.origin,
      figure,
    );
  };

  // One operation as a form, for the rows to complete and the one being
  // edited.
  const card = (row: EditedOperation, index: number) => {
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
            "border-warn/50 bg-warn/5",
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
                onChange={(symbol, added, line) => {
                  const instrument =
                    added ?? instruments.find((each) => each.symbol === symbol);
                  const currency = line
                    ? "USD"
                    : lineOf(instrument, "USD")
                      ? instrument?.currency
                      : undefined;
                  change(row.id, {
                    symbol,
                    ...(currency && { currency }),
                  });
                }}
                onAdded={addToCatalog}
                markets={marketsFor(institution)}
                suggestion={item.operations?.[index]?.unknownSymbol}
                lines
                line={lineOf(
                  instruments.find((each) => each.symbol === row.symbol),
                  row.currency,
                )}
                placeholder="Elegí un activo"
              />
            ) : (
              <span className="truncate font-medium">
                {instrumentLabel(row.symbol, names.get(row.symbol))}
              </span>
            )}
            <span className="text-muted-foreground flex flex-wrap gap-x-2 text-xs">
              {row.source && <span>{row.source}</span>}
              {item.origin !== "sync" && (
                <span>{`Confianza ${CONFIDENCE_LABELS[row.confidence].toLowerCase()}`}</span>
              )}
              {row.reference && <span>{`N° ${row.reference}`}</span>}
              {row.loaded && (
                <span className="text-foreground">Ya está cargada</span>
              )}
            </span>
            {!row.discarded && missing[index]!.has("symbol") && (
              <ProblemText
                text={
                  item.operations?.[index]?.unknownSymbol
                    ? "No lo encontramos entre los activos: elegilo en la lista"
                    : missingCopy
                }
              />
            )}
          </div>
          {editing === row.id ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setEditing(null)}
            >
              Listo
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={isLocked(row)}
              aria-label={`${row.discarded ? "Recuperar" : "Descartar"} la operación ${index + 1}`}
              onClick={() => change(row.id, { discarded: !row.discarded })}
            >
              {row.discarded ? <RotateCcw /> : <X />}
              {row.discarded ? "Recuperar" : "Descartar"}
            </Button>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
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
                className="w-full"
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
              <ProblemText text={missingCopy} />
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
              <ProblemText
                text={lackingDate(
                  row.date,
                  item.operations?.[index]?.date ?? null,
                  item.origin,
                  today,
                )}
              />
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
                className="w-full"
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
          <div className={cn("grid gap-3", "sm:grid-cols-4")}>
            {trade ? (
              <>
                <Figure
                  label="Cantidad"
                  aria={`Cantidad de la operación ${index + 1}`}
                  value={row.quantityText}
                  disabled={row.discarded}
                  problem={problem(index, "quantity")}
                  onChange={(quantityText) => change(row.id, { quantityText })}
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
                  onChange={(priceText) => change(row.id, { priceText })}
                />
              </>
            ) : (
              <Figure
                label={`Monto (${row.currency})`}
                aria={`Monto de la operación ${index + 1}`}
                value={row.amountText}
                disabled={row.discarded}
                problem={problem(index, "amount")}
                onChange={(amountText) => change(row.id, { amountText })}
              />
            )}
            <Figure
              label={`Gastos (${row.currency}) · Opcional`}
              aria={`Gastos de la operación ${index + 1}`}
              value={row.chargesText}
              disabled={row.discarded}
              problem={problem(index, "charges")}
              onChange={(chargesText) => change(row.id, { chargesText })}
            />
            {trade && (
              <div className="grid gap-1 text-xs">
                <span className="text-muted-foreground">{`Total (${row.currency})`}</span>
                <span className="flex h-9 items-center text-sm font-medium tabular-nums">
                  {tradeTotal(row, type, row.currency)}
                </span>
              </div>
            )}
          </div>
        )}
      </li>
    );
  };

  // The rows that needed something when the review opened stay on top until
  // it is confirmed, so completing one does not move it; the rest go in the
  // table.
  const listed = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => shown(row));
  const attentionRows = listed.filter(({ row }) => attention.has(row.id));
  const readyRows = listed.filter(({ row }) => !attention.has(row.id));

  return (
    <div className="grid gap-4">
      <PageCrumbs
        crumbs={[{ label: "Cargar", href: backHref }, { label: item.fileName }]}
      />
      <div className="flex min-h-7 flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="sr-only">Revisá las operaciones que leímos</h1>
        <p className="text-muted-foreground text-xs">{institution}</p>
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
          <h2 id={`${pickerId}-list`} className="text-sm font-semibold">
            {countOf(rows.length, "operación", "operaciones")}
          </h2>
          {incomplete > 0 && (
            <Badge variant="warning">{`${incomplete} con datos faltantes`}</Badge>
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
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={kindShown}
            onValueChange={(value) =>
              setKindShown(value as ImportOperationKind | "all")
            }
          >
            <SelectTrigger
              size="sm"
              aria-label="Mostrar operaciones de tipo"
              className="w-40"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los tipos</SelectItem>
              {KINDS.map((kind) => (
                <SelectItem key={kind} value={kind}>
                  {MOVEMENT_KIND_LABELS[kind]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {symbols.length > 1 && (
            <Select value={symbolShown} onValueChange={setSymbolShown}>
              <SelectTrigger
                size="sm"
                aria-label="Mostrar operaciones del activo"
                className="w-40"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los activos</SelectItem>
                {symbols.map((symbol) => (
                  <SelectItem key={symbol} value={symbol}>
                    {symbol}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <span role="status" className="text-muted-foreground text-xs">
            {`${keptCount} de ${rows.length} para importar`}
          </span>
        </div>
        {attentionRows.length > 0 && (
          <section className="grid gap-2" aria-labelledby={`${pickerId}-todo`}>
            <h3 id={`${pickerId}-todo`} className="text-xs font-medium">
              {`Para completar (${attentionRows.length})`}
            </h3>
            <ul className="grid gap-2">
              {attentionRows.map(({ row, index }) => card(row, index))}
            </ul>
          </section>
        )}
        {readyRows.length > 0 && (
          <section className="grid gap-2" aria-labelledby={`${pickerId}-ready`}>
            {attentionRows.length > 0 && (
              <h3 id={`${pickerId}-ready`} className="text-xs font-medium">
                {`Listas para importar (${readyRows.length})`}
              </h3>
            )}
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableCaption className="sr-only">
                  Operaciones listas para importar
                </TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <input
                        type="checkbox"
                        aria-label="Incluir todas las que se ven"
                        className="accent-primary size-4 align-middle"
                        checked={readyRows.every(({ row }) => !row.discarded)}
                        onChange={(event) => keepShown(event.target.checked)}
                      />
                    </TableHead>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Activo</TableHead>
                    <TableHead className="text-right">Cantidad</TableHead>
                    <TableHead className="text-right">Precio</TableHead>
                    <TableHead className="text-right">Gastos</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="w-10">
                      <span className="sr-only">Editar</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {readyRows.map(({ row, index }) =>
                    editing === row.id ? (
                      <TableRow key={row.id} className="hover:bg-transparent">
                        <TableCell colSpan={9} className="p-2">
                          <ul>{card(row, index)}</ul>
                        </TableCell>
                      </TableRow>
                    ) : (
                      <TableRow
                        key={row.id}
                        aria-label={`Operación ${index + 1}`}
                        className={cn(
                          "text-xs",
                          row.discarded && "text-muted-foreground",
                        )}
                      >
                        <TableCell>
                          <input
                            type="checkbox"
                            aria-label={`Incluir la operación ${index + 1}`}
                            className="accent-primary size-4 align-middle"
                            checked={!row.discarded}
                            disabled={isLocked(row)}
                            onChange={(event) =>
                              change(row.id, {
                                discarded: !event.target.checked,
                              })
                            }
                          />
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {row.date ? formatDate(row.date) : "—"}
                        </TableCell>
                        <TableCell>
                          {row.kind ? MOVEMENT_KIND_LABELS[row.kind] : "—"}
                        </TableCell>
                        <TableCell className="max-w-48">
                          <span
                            className="block truncate font-medium"
                            title={names.get(row.symbol)}
                          >
                            {row.symbol}
                          </span>
                          {row.loaded && (
                            <span className="text-muted-foreground block">
                              Ya está cargada
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {figureText(finals[index]!.quantity, formatQuantity)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {figureText(finals[index]!.price, (price) =>
                            formatPrice(price, row.currency),
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {figureText(finals[index]!.charges, (charges) =>
                            formatAmount(charges, row.currency),
                          )}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {row.kind === "purchase" || row.kind === "sale"
                            ? tradeTotal(
                                row,
                                types.get(row.symbol),
                                row.currency,
                              )
                            : figureText(finals[index]!.amount, (amount) =>
                                formatAmount(amount, row.currency),
                              )}
                        </TableCell>
                        <TableCell>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="text-muted-foreground hover:text-foreground size-7"
                            aria-label={`Editar la operación ${index + 1}`}
                            onClick={() => setEditing(row.id)}
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ),
                  )}
                </TableBody>
              </Table>
            </div>
          </section>
        )}
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

// The market's listing for exactly what an import called an instrument: its
// own symbol, or one of its dollar lines (GOGLD is GOOGL's MEP line).
export function exactListing(
  listings: readonly Listing[],
  called: string,
): { listing: Listing; line: DollarLine | null } | null {
  const wanted = normalizeSymbol(called);
  for (const listing of listings) {
    if (normalizeSymbol(listing.symbol) === wanted) {
      return { listing, line: null };
    }
    if (listing.lines?.some((each) => normalizeSymbol(each) === wanted)) {
      return { listing, line: wanted.endsWith("C") ? "C" : "D" };
    }
  }
  return null;
}

// A figure as the table shows it, or a dash where there is none.
const figureText = (
  value: string | null,
  format: (value: string) => string,
): string => (value === null ? "—" : format(value));

// A trade's quantity times its unit price as typed; the broker's own total
// when the instrument, and so how its price is quoted, is not known yet.
function tradeTotal(
  row: { quantityText: string; priceText: string; amountText: string },
  type: Parameters<typeof exactUnitPrice>[0] | undefined,
  currency: Currency,
): string {
  const quantity = parseAmountInput(row.quantityText);
  const price = parseAmountInput(row.priceText);
  const perUnit = price && type ? exactUnitPrice(type, price) : null;
  const total =
    quantity && perUnit
      ? toDecimal(times(exactOf(quantity), exactOf(perUnit)), 2)
      : parseAmountInput(row.amountText);
  return total ? formatAmount(total, currency) : "—";
}

function ProblemText({ text }: { text: string }) {
  return (
    <span className="flex items-center gap-1 text-xs">
      <TriangleAlert aria-hidden className="text-warn size-3" />
      {text}
    </span>
  );
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
