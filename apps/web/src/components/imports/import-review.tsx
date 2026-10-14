"use client";

import {
  documentDateIssue,
  exactUnitPrice,
  type InstrumentType,
  validateHoldings,
} from "@plant/core";
import { buenosAiresDate, exactOf, times, toDecimal } from "@plant/shared";
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
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { InstrumentPicker } from "@/components/holdings/instrument-picker";
import {
  holdingsCountText,
  MissingFigure,
} from "@/components/holdings/sum-text";
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
import { countOf } from "@/lib/format/text";
import {
  amountInput,
  formatAmount,
  formatQuantity,
  parseAmountInput,
} from "@/lib/format/amount";
import { formatDate } from "@/lib/format/date";
import {
  currencyOf,
  instrumentLabel,
  instrumentNames,
} from "@/lib/holdings/holding-name";
import { MOVEMENT_MESSAGES } from "@/lib/holdings/messages";
import { priceBasisLabel, quotedInput } from "@/lib/holdings/price-input";
import type { MovementResult } from "@/lib/holdings/movements-input";
import type { InstrumentRow } from "@/lib/holdings/read";
import {
  CONFIDENCE_LABELS,
  DATE_ISSUE_LABELS,
  type ImportItem,
  type ImportRow,
  ISSUE_LABELS,
  readTotals,
  rowChange,
  totalsMatch,
} from "@/lib/imports/review";
import { settle } from "@/lib/server-action-call";
import { cn } from "@/lib/utils";

export type ReviewActions = {
  confirm: (id: string, rows: ImportRow[]) => Promise<MovementResult>;
};

// A row as the user edits it: the quantity and price as typed, and whether
// they choose its instrument: one they added, or one the reading named that
// Plant does not know.
type EditedRow = ImportRow & {
  quantityText: string;
  priceText: string;
  // The cost the document printed, as typed; shown only when it printed one.
  costText: string;
  printsCost: boolean;
  added: boolean;
};

// A row's price is per unit; the user reads and types it as the market
// quotes it, a bond's per 100 nominal.
const edited = (
  row: ImportRow,
  type: InstrumentType | undefined,
  added = false,
): EditedRow => ({
  ...row,
  quantityText: amountInput(row.quantity),
  priceText: row.price === null ? "" : quotedInput(row.price, type),
  costText: row.cost == null ? "" : quotedInput(row.cost, type),
  printsCost: row.cost != null,
  added,
});

// A typed quote as the price of one unit, or null where it is not a number.
function typedPrice(text: string, type: InstrumentType | undefined) {
  const quoted = parseAmountInput(text);
  if (quoted === null || !type) return quoted;
  return exactUnitPrice(type, quoted);
}

const CHANGE_TEXT = {
  new: "Nueva",
  same: "Sin cambios",
  discarded: "Descartada",
} as const;

// What picking a row's instrument changes: a price, value or cost printed in
// another currency no longer describes the row, so the user types the price.
export function pickedInstrument(
  printed: ImportRow["currency"],
  symbol: string,
  instruments: readonly Pick<InstrumentRow, "symbol" | "currency">[],
) {
  const currency = currencyOf(instruments, symbol);
  return {
    symbol,
    currency,
    ...(currency !== printed && {
      value: null,
      priceText: "",
      costText: "",
      printsCost: false,
    }),
  };
}

// What the reading made of a document, to correct, discard or add to before
// it goes into the account: each row with how sure the reading is and where
// it was read, what it changes in the account, and the totals read against
// the ones the document prints.
export function ImportReview({
  item,
  institution,
  instruments,
  held,
  accounts,
  routing,
  backHref,
  doneHref,
  actions,
}: {
  item: ImportItem;
  institution: string;
  instruments: InstrumentRow[];
  // What the account holds of each instrument now.
  held: ReadonlyMap<string, string>;
  // When the document lists several accounts: the user's accounts a row may
  // go to, each with what it holds, its default portfolio and the user's
  // other accounts holding each instrument.
  accounts?: readonly {
    id: string;
    institution: string;
    held: ReadonlyMap<string, string>;
    defaultPortfolioId: string;
    elsewhere: ReadonlyMap<
      string,
      readonly { id: string; institution: string }[]
    >;
  }[];
  // On a page that lets a row choose where its units go: the portfolios, the
  // account's default one, and the user's other accounts holding each
  // instrument, which the units may come from as a transfer.
  routing?: {
    portfolios: readonly { id: string; name: string }[];
    defaultPortfolioId: string;
    elsewhere: ReadonlyMap<
      string,
      readonly { id: string; institution: string }[]
    >;
  };
  backHref: string;
  doneHref: string;
  actions: ReviewActions;
}) {
  const router = useRouter();
  const pickerId = useId();
  const names = instrumentNames(instruments);
  const types = new Map(instruments.map((each) => [each.symbol, each.type]));
  const [rows, setRows] = useState(() =>
    item.rows.map((row) =>
      edited(row, types.get(row.symbol), row.symbol === ""),
    ),
  );
  const [alert, setAlert] = useState<string>();
  const [pending, startTransition] = useTransition();

  // The rows as they would be saved; null where a typed value is not a number.
  const parsed = rows.map((row) => {
    const quantity = parseAmountInput(row.quantityText);
    const price =
      row.priceText.trim() === ""
        ? null
        : typedPrice(row.priceText, types.get(row.symbol));
    const cost =
      row.costText.trim() === ""
        ? null
        : typedPrice(row.costText, types.get(row.symbol));
    return { row, quantity, price, cost };
  });
  // What the account a row goes to holds: the import's, or the one the
  // review routed it to.
  const accountOf = (row: EditedRow) => row.accountId ?? item.accountId;
  const heldFor = (row: EditedRow) =>
    accountOf(row) === item.accountId
      ? held
      : (accounts?.find((each) => each.id === accountOf(row))?.held ??
        new Map<string, string>());
  // Where a row's units may go, from the account it goes to. When the
  // document lists several accounts, none it lists is a transfer's source: it
  // already gives that account's figure.
  const routingFor = (
    row: EditedRow,
    base: NonNullable<typeof routing>,
  ): NonNullable<typeof routing> => {
    const other =
      accountOf(row) === item.accountId
        ? undefined
        : accounts?.find((each) => each.id === accountOf(row));
    const elsewhere = other?.elsewhere ?? base.elsewhere;
    const listedAccounts = new Set([
      item.accountId,
      ...rows.filter((each) => !each.discarded).map(accountOf),
    ]);
    return {
      ...base,
      defaultPortfolioId: other?.defaultPortfolioId ?? base.defaultPortfolioId,
      elsewhere: accounts
        ? new Map(
            [...elsewhere].map(([symbol, sources]) => [
              symbol,
              sources.filter((source) => !listedAccounts.has(source.id)),
            ]),
          )
        : elsewhere,
    };
  };
  const addsUnits = (row: EditedRow, quantity: string | null) => {
    const effect = rowChange(
      { quantity: quantity ?? "0", discarded: row.discarded },
      heldFor(row).get(row.symbol),
    );
    return effect.kind === "new" || effect.kind === "up";
  };
  // The account a row's units come from, while it still adds units and that
  // account is still offered.
  const transferOf = (row: EditedRow, quantity: string | null) =>
    row.transferFrom !== undefined &&
    routing &&
    addsUnits(row, quantity) &&
    (routingFor(row, routing).elsewhere.get(row.symbol) ?? []).some(
      (source) => source.id === row.transferFrom,
    )
      ? row.transferFrom
      : undefined;
  // A row that adds units to the account needs their price, unless they come
  // from another account, carrying their cost.
  const needsPrice = (row: EditedRow, quantity: string | null) =>
    addsUnits(row, quantity) && transferOf(row, quantity) === undefined;
  // A cost kept is what a new holding comes in at, so its price is not
  // needed then; units added to one held come in at the price.
  const opensWithCost = (
    row: EditedRow,
    quantity: string | null,
    cost: string | null,
  ) =>
    cost !== null &&
    rowChange(
      { quantity: quantity ?? "0", discarded: row.discarded },
      heldFor(row).get(row.symbol),
    ).kind === "new";
  const costInvalid = ({ row, cost }: (typeof parsed)[number]) =>
    !row.discarded &&
    row.costText.trim() !== "" &&
    (cost === null || exactOf(cost).n === 0n);
  const priceInvalid = ({
    row,
    quantity,
    price,
    cost,
  }: (typeof parsed)[number]) =>
    !row.discarded &&
    (price === null
      ? row.priceText.trim() !== "" ||
        (needsPrice(row, quantity) && !opensWithCost(row, quantity, cost))
      : exactOf(price).n === 0n &&
        needsPrice(row, quantity) &&
        !opensWithCost(row, quantity, cost));
  // The instruments the rows kept already list in each account: one row
  // each.
  const listedCount = new Map<string, number>();
  for (const row of rows) {
    if (row.discarded) continue;
    const key = `${row.symbol}|${accountOf(row)}`;
    listedCount.set(key, (listedCount.get(key) ?? 0) + 1);
  }
  // Whether another kept row lists the instrument in the row's account.
  const listedElsewhere = (row: EditedRow, symbol: string) =>
    (listedCount.get(`${symbol}|${accountOf(row)}`) ?? 0) -
      (!row.discarded && row.symbol === symbol ? 1 : 0) >
    0;
  // A row a document lists under an account names none of the user's until
  // the review picks one.
  const unrouted = (row: EditedRow) =>
    row.accountLabel !== undefined && row.accountId === undefined;
  const valid = parsed.every(
    (each) =>
      each.row.discarded ||
      (each.quantity !== null &&
        exactOf(each.quantity).n > 0n &&
        each.row.symbol !== "" &&
        !unrouted(each.row) &&
        !listedElsewhere(each.row, each.row.symbol) &&
        !priceInvalid(each) &&
        !costInvalid(each)),
  );
  const finalRows: ImportRow[] = parsed.map(
    ({ row, quantity, price, cost }) => ({
      id: row.id,
      symbol: row.symbol,
      quantity: quantity ?? "0",
      price,
      cost,
      value: row.value ?? null,
      currency: row.currency,
      confidence: row.confidence,
      source: row.source,
      discarded: row.discarded,
      ...(row.portfolioId !== undefined && { portfolioId: row.portfolioId }),
      ...(row.accountLabel !== undefined && { accountLabel: row.accountLabel }),
      ...(row.accountId !== undefined && { accountId: row.accountId }),
      ...(transferOf(row, quantity) !== undefined && {
        transferFrom: transferOf(row, quantity),
      }),
    }),
  );
  const totals = readTotals(finalRows);
  const matches = totalsMatch(totals, item.documentTotals);
  // What the kept rows' figures fail, as they stand: a corrected row clears.
  // Prices are per unit here, whatever the instrument's quote basis.
  const issues = validateHoldings(
    finalRows.map((row) => ({
      symbol: row.discarded ? "" : row.symbol,
      quantity: row.quantity,
      price: row.discarded ? null : row.price,
      value: row.value ?? null,
      basis: 1,
    })),
  );
  const dateIssue = documentDateIssue(
    item.documentDate,
    buenosAiresDate(new Date()),
  );
  const doubtful = rows.filter(
    (row, index) =>
      !row.discarded && (row.confidence === "low" || issues[index]!.length > 0),
  ).length;
  // What the account holds that no kept row lists: it stays as it is.
  const kept = new Set(
    rows
      .filter((row) => !row.discarded && accountOf(row) === item.accountId)
      .map((row) => row.symbol),
  );
  const omitted = [...held.keys()].filter((symbol) => !kept.has(symbol));

  const change = (id: string, patch: Partial<EditedRow>) =>
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    );

  function confirm() {
    if (!valid) {
      setAlert(
        "Revisá las filas: cada una necesita un activo que no se repita en su cuenta, una cantidad mayor a 0, su cuenta si el documento lista varias y, si suma unidades, su precio.",
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
          {dateIssue && (
            <p className="flex items-center gap-1 text-sm text-amber-700 dark:text-amber-300">
              <TriangleAlert aria-hidden className="size-4" />
              {DATE_ISSUE_LABELS[dateIssue]}
            </p>
          )}
        </div>
      </div>

      {item.skippedRows > 0 && (
        <p
          role="status"
          className="flex items-center gap-2 rounded-lg border border-amber-500/50 p-4 text-sm"
        >
          <TriangleAlert
            aria-hidden
            className="size-4 shrink-0 text-amber-600"
          />
          {item.skippedRows === 1
            ? "Una fila de la planilla no se pudo leer: fijate que no falte ninguna tenencia."
            : `${item.skippedRows} filas de la planilla no se pudieron leer: fijate que no falte ninguna tenencia.`}
        </p>
      )}

      <section
        className={cn(
          "grid gap-2 rounded-lg border p-4",
          matches === true
            ? "border-emerald-600/40"
            : matches === false && "border-amber-500/50",
        )}
        aria-label="Totales"
      >
        <p className="flex items-center gap-2 text-sm font-medium">
          {matches === true && (
            <Check aria-hidden className="size-4 text-emerald-600" />
          )}
          {matches === false && (
            <TriangleAlert aria-hidden className="size-4 text-amber-600" />
          )}
          {matches === "none"
            ? "El documento no muestra un total para comparar: revisá las filas."
            : matches
              ? "Lo leído suma lo mismo que el documento."
              : "Lo leído no suma lo mismo que el documento: revisá las filas dudosas."}
        </p>
        <table className="w-fit text-sm tabular-nums">
          <caption className="sr-only">Totales por moneda</caption>
          <thead>
            <tr className="text-muted-foreground text-left text-xs">
              <th scope="col" className="pr-6 font-normal">
                Moneda
              </th>
              <th scope="col" className="pr-6 font-normal">
                Leído
              </th>
              <th scope="col" className="font-normal">
                Documento
              </th>
            </tr>
          </thead>
          <tbody>
            {[
              ...new Set(
                [...item.documentTotals, ...totals].map(
                  ({ currency }) => currency,
                ),
              ),
            ].map((currency) => {
              const amountIn = (list: typeof totals) =>
                list.find((each) => each.currency === currency)?.amount;
              const printed = amountIn(item.documentTotals);
              return (
                <tr key={currency}>
                  <th scope="row" className="pr-6 text-left font-normal">
                    {currency}
                  </th>
                  <td className="pr-6">
                    {formatAmount(amountIn(totals) ?? "0", currency)}
                  </td>
                  <td>
                    {printed === undefined ? (
                      <MissingFigure text="Sin total en el documento" />
                    ) : (
                      formatAmount(printed, currency)
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">
            {holdingsCountText(rows.filter((row) => !row.discarded).length)}
            {doubtful > 0 && (
              <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-xs font-normal text-amber-700 dark:text-amber-300">
                {countOf(doubtful, "dudosa", "dudosas")}
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
                edited(
                  {
                    id: `added-${current.length}`,
                    symbol: "",
                    quantity: "0",
                    price: null,
                    currency: "ARS",
                    confidence: "high",
                    source: "Agregada por vos",
                    discarded: false,
                  },
                  undefined,
                  true,
                ),
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
            const type = types.get(row.symbol);
            const effect = rowChange(
              { quantity: quantity ?? "0", discarded: row.discarded },
              heldFor(row).get(row.symbol),
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
                  (row.confidence === "low" || issues[index]!.length > 0) &&
                    !row.discarded &&
                    "border-amber-500/60 bg-amber-500/5",
                  row.discarded && "opacity-50",
                )}
              >
                <div className="grid min-w-0 gap-1">
                  {row.added ? (
                    <InstrumentPicker
                      id={`${pickerId}-${row.id}`}
                      aria-label={`Activo de la fila ${index + 1}`}
                      instruments={instruments.filter(
                        (each) => !listedElsewhere(row, each.symbol),
                      )}
                      value={row.symbol}
                      onChange={(symbol) =>
                        change(
                          row.id,
                          pickedInstrument(row.currency, symbol, instruments),
                        )
                      }
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
                    <span className="text-foreground">
                      {effect.kind === "up" || effect.kind === "down"
                        ? `${effect.kind === "up" ? "Sube" : "Baja"} de ${formatQuantity(effect.held)}`
                        : CHANGE_TEXT[effect.kind]}
                    </span>
                  </span>
                  {issues[index]!.map((issue) => (
                    <span
                      key={issue}
                      className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300"
                    >
                      <TriangleAlert aria-hidden className="size-3" />
                      {ISSUE_LABELS[issue]}
                    </span>
                  ))}
                </div>
                {row.accountLabel !== undefined && accounts && (
                  <label className="grid gap-1 text-xs sm:col-span-4">
                    <span className="text-muted-foreground">
                      {`Cuenta · el documento dice "${row.accountLabel}"`}
                    </span>
                    <Select
                      value={row.accountId ?? ""}
                      disabled={row.discarded}
                      onValueChange={(accountId) =>
                        change(row.id, {
                          accountId,
                          portfolioId: undefined,
                          transferFrom: undefined,
                        })
                      }
                    >
                      <SelectTrigger
                        aria-label={`Cuenta de la fila ${index + 1}`}
                        aria-invalid={
                          (!row.discarded && unrouted(row)) || undefined
                        }
                      >
                        <SelectValue placeholder="Elegí una cuenta" />
                      </SelectTrigger>
                      <SelectContent>
                        {accounts.map((each) => (
                          <SelectItem key={each.id} value={each.id}>
                            {each.institution}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                )}
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
                    {type
                      ? `Precio ${priceBasisLabel(type)} (${row.currency})`
                      : `Precio (${row.currency})`}
                    {value && (
                      <span className="text-foreground ml-1 tabular-nums">
                        {`· ${formatAmount(value, row.currency)}`}
                      </span>
                    )}
                  </span>
                  <Input
                    value={row.priceText}
                    aria-label={`Precio de la fila ${index + 1}`}
                    aria-invalid={priceInvalid(parsed[index]!) || undefined}
                    inputMode="decimal"
                    disabled={row.discarded}
                    onChange={(event) =>
                      change(row.id, { priceText: event.target.value })
                    }
                  />
                </label>
                {row.printsCost && (
                  <label className="grid gap-1 text-xs sm:col-start-3">
                    <span className="text-muted-foreground">
                      {type
                        ? `Costo promedio ${priceBasisLabel(type)} (${row.currency})`
                        : `Costo promedio (${row.currency})`}
                    </span>
                    <Input
                      value={row.costText}
                      aria-label={`Costo promedio de la fila ${index + 1}`}
                      aria-invalid={costInvalid(parsed[index]!) || undefined}
                      inputMode="decimal"
                      disabled={row.discarded}
                      onChange={(event) =>
                        change(row.id, { costText: event.target.value })
                      }
                    />
                  </label>
                )}
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
                {routing &&
                  !row.discarded &&
                  (effect.kind === "new" || effect.kind === "up") && (
                    <RowRouting
                      index={index}
                      row={row}
                      isNew={effect.kind === "new"}
                      routing={routingFor(row, routing)}
                      onChange={(patch) => change(row.id, patch)}
                    />
                  )}
              </li>
            );
          })}
        </ul>
      </section>

      {omitted.length > 0 && (
        <section className="grid gap-2" aria-labelledby={`${pickerId}-omitted`}>
          <h2 id={`${pickerId}-omitted`} className="text-base font-semibold">
            No figuran en el resumen
          </h2>
          <p className="text-muted-foreground text-xs">
            Los tenés en la cuenta y el documento no los lista: quedan como
            están.
          </p>
          <ul className="grid gap-1 text-sm">
            {omitted.map((symbol) => (
              <li key={symbol} className="flex justify-between gap-4">
                <span className="truncate">
                  {instrumentLabel(symbol, names.get(symbol))}
                </span>
                <span className="text-muted-foreground tabular-nums">
                  {formatQuantity(held.get(symbol)!)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

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

const PURCHASE = "purchase";

// Where a row's units go, on a page that lets it choose: the portfolio a new
// instrument goes to, and whether the units come from another account, as a
// transfer that keeps their cost.
function RowRouting({
  index,
  row,
  isNew,
  routing,
  onChange,
}: {
  index: number;
  row: EditedRow;
  isNew: boolean;
  routing: NonNullable<Parameters<typeof ImportReview>[0]["routing"]>;
  onChange: (patch: Partial<EditedRow>) => void;
}) {
  const sources = routing.elsewhere.get(row.symbol) ?? [];
  if (!isNew && sources.length === 0) return null;
  const portfolio = row.portfolioId ?? routing.defaultPortfolioId;
  const origin =
    sources.find((each) => each.id === row.transferFrom)?.id ?? PURCHASE;
  const originText = (value: string) =>
    value === PURCHASE
      ? "Compra o saldo propio"
      : `Traspaso desde ${sources.find((each) => each.id === value)?.institution ?? ""}`;
  return (
    <div className="grid gap-3 text-xs sm:col-span-4 sm:grid-cols-2">
      {isNew && (
        <label className="grid gap-1">
          <span className="text-muted-foreground">Cartera</span>
          <Select
            value={portfolio}
            onValueChange={(value) => onChange({ portfolioId: value })}
          >
            <SelectTrigger
              size="sm"
              className="w-full"
              aria-label={`Cartera de la fila ${index + 1}`}
            >
              <SelectValue>
                {routing.portfolios.find((each) => each.id === portfolio)?.name}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {routing.portfolios.map((each) => (
                <SelectItem key={each.id} value={each.id}>
                  {each.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      )}
      {sources.length > 0 && (
        <label className="grid gap-1">
          <span className="text-muted-foreground">
            {`Ya tenés ${row.symbol} en otra cuenta. ¿Es un traspaso?`}
          </span>
          <Select
            value={origin}
            onValueChange={(value) =>
              onChange({
                transferFrom: value === PURCHASE ? undefined : value,
              })
            }
          >
            <SelectTrigger
              size="sm"
              className="w-full"
              aria-label={`Origen de la fila ${index + 1}`}
            >
              <SelectValue>{originText(origin)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {[PURCHASE, ...sources.map((each) => each.id)].map((value) => (
                <SelectItem key={value} value={value}>
                  {originText(value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      )}
    </div>
  );
}
