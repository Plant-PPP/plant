"use client";

import { PageCrumbs } from "@/components/layout/page-crumbs";
import { Notice } from "@/components/ui/notice";
import { Badge } from "@/components/ui/badge";
import {
  documentDateIssue,
  exactUnitPrice,
  type InstrumentType,
  validateHoldings,
} from "@plant/core";
import {
  buenosAiresDate,
  type Currency,
  exactOf,
  times,
  toDecimal,
} from "@plant/shared";
import { Check, Plus, RotateCcw, TriangleAlert, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { useCatalog } from "@/components/holdings/instrument-market";
import {
  type DollarLine,
  InstrumentPicker,
  lineOf,
} from "@/components/holdings/instrument-picker";
import { marketsFor } from "@/lib/instruments/markets";
import { LeftOutNotice } from "@/components/imports/left-out-notice";
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
  unlabeledName,
} from "@/lib/holdings/holding-name";
import { ASSET_CLASS_LABELS, MOVEMENT_MESSAGES } from "@/lib/holdings/messages";
import { priceBasisLabel, quotedInput } from "@/lib/holdings/price-input";
import type { MovementResult } from "@/lib/holdings/movements-input";
import type { InstrumentRow } from "@/lib/holdings/read";
import type { HeldCash } from "@/lib/imports/cash";
import {
  CONFIDENCE_LABELS,
  DATE_ISSUE_LABELS,
  fileNoun,
  type ImportItem,
  type ImportRow,
  issueLabel,
  readTotals,
  type RowChange,
  rowChange,
  savedToast,
  totalsMatch,
} from "@/lib/imports/review";
import { settle } from "@/lib/server-action-call";
import { cn } from "@/lib/utils";

export type ReviewActions = {
  confirm: (
    id: string,
    rows: ImportRow[],
    heldCash: readonly HeldCash[],
  ) => Promise<MovementResult>;
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

// What the review asks of its rows when one is not ready, by what it read.
export function invalidRowsAlert(origin: ImportItem["origin"]): string {
  const account =
    origin === "sync" ? "" : `, su cuenta si ${fileNoun(origin)} lista varias`;
  return `Revisá las filas: cada una necesita un activo que no se repita en su cuenta, una cantidad mayor a 0${account} y, si suma unidades, su precio.`;
}

// What the reading left out, by what it read.
function skippedLine({
  origin,
  skippedRows: count,
}: Pick<ImportItem, "origin" | "skippedRows">) {
  const one = count === 1;
  switch (origin) {
    case "sync":
      return one
        ? "Hay un saldo o tenencia que la sincronización no pudo traer: fijate que no falte ninguno."
        : `Hay ${count} saldos o tenencias que la sincronización no pudo traer: fijate que no falte ninguno.`;
    case "document":
      return one
        ? "Una tenencia del documento quedó afuera: fijate que no falte ninguna."
        : `${count} tenencias del documento quedaron afuera: fijate que no falte ninguna.`;
    case "sheet":
      return one
        ? "Una fila de la planilla no se pudo leer: fijate que no falte ninguna tenencia."
        : `${count} filas de la planilla no se pudieron leer: fijate que no falte ninguna tenencia.`;
  }
}

// What picking a row's instrument changes: a price, value or cost printed in
// another currency no longer describes the row, so the user types the price.
export function pickedInstrument(
  printed: ImportRow["currency"],
  symbol: string,
  instruments: readonly Pick<InstrumentRow, "symbol" | "currency">[],
  line: DollarLine | null = null,
) {
  const currency = line ? "USD" : currencyOf(instruments, symbol);
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

// An account's cash in each currency, and the currencies it holds in more
// than one cash holding, which a statement's balance does not update.
export type AccountCash = {
  held: ReadonlyMap<Currency, string>;
  several: ReadonlySet<Currency>;
};

// What the reading made of a document, to correct, discard or add to before
// it goes into the account: each row with how sure the reading is and where
// it was read, what it changes in the account, and the totals read against
// the ones the document prints.
export function ImportReview({
  item,
  institution,
  instruments: givenInstruments,
  held,
  cash,
  heldCash = [],
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
  // The account's cash now, when the page reads it.
  cash?: AccountCash;
  // The cash holdings `cash` and each account's add up, as read: the confirm
  // writes a balance only while its cash is still what they say.
  heldCash?: readonly HeldCash[];
  // When the document lists several accounts: the user's accounts a row may
  // go to, each with what it holds, its default portfolio and the user's
  // other accounts holding each instrument.
  accounts?: readonly {
    id: string;
    institution: string;
    held: ReadonlyMap<string, string>;
    cash?: AccountCash;
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
  const [instruments, addToCatalog] = useCatalog(givenInstruments);
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
  const cashFor = (row: EditedRow) =>
    accountOf(row) === item.accountId
      ? cash
      : accounts?.find((each) => each.id === accountOf(row))?.cash;
  const isCash = (row: EditedRow) => row.assetClass === "cash";
  // What the account holds of the row's instrument, or its cash in the row's
  // currency.
  const heldOf = (row: EditedRow) =>
    isCash(row)
      ? cashFor(row)?.held.get(row.currency)
      : heldFor(row).get(row.symbol);
  // Only cash may be at zero: a balance at zero brings the account's cash in
  // its currency to zero, and changes nothing where it holds none.
  const quantityInvalid = (row: EditedRow, quantity: string | null) =>
    quantity === null ||
    exactOf(quantity).n < 0n ||
    (exactOf(quantity).n === 0n && !isCash(row));
  const changeOf = (row: EditedRow, quantity: string | null): RowChange =>
    isCash(row) &&
    !row.discarded &&
    heldOf(row) === undefined &&
    quantity !== null &&
    exactOf(quantity).n === 0n
      ? { kind: "same" }
      : rowChange(
          { quantity: quantity ?? "0", discarded: row.discarded },
          heldOf(row),
        );
  // Cash the account holds in several holdings of the row's currency.
  const severalCash = (row: EditedRow) =>
    isCash(row) && (cashFor(row)?.several.has(row.currency) ?? false);
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
      heldOf(row),
    );
    return effect.kind === "new" || effect.kind === "up";
  };
  // The account a row's units come from, while it still adds units and that
  // account is still offered.
  const transferOf = (row: EditedRow, quantity: string | null) =>
    !isCash(row) &&
    row.transferFrom !== undefined &&
    routing &&
    addsUnits(row, quantity) &&
    (routingFor(row, routing).elsewhere.get(row.symbol) ?? []).some(
      (source) => source.id === row.transferFrom,
    )
      ? row.transferFrom
      : undefined;
  // A row that adds units to the account needs their price, unless they come
  // from another account, carrying their cost. Cash has none.
  const needsPrice = (row: EditedRow, quantity: string | null) =>
    !isCash(row) &&
    addsUnits(row, quantity) &&
    transferOf(row, quantity) === undefined;
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
      heldOf(row),
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
  // The instruments and the cash currencies the rows kept already list in
  // each account: one row each.
  const keyOf = (row: EditedRow, symbol: string) =>
    `${isCash(row) ? "cash" : "instrument"}|${symbol}|${accountOf(row)}`;
  const listedCount = new Map<string, number>();
  for (const row of rows) {
    if (row.discarded) continue;
    const key = keyOf(row, row.symbol);
    listedCount.set(key, (listedCount.get(key) ?? 0) + 1);
  }
  // Whether another kept row lists the instrument in the row's account.
  const listedElsewhere = (row: EditedRow, symbol: string) =>
    (listedCount.get(keyOf(row, symbol)) ?? 0) -
      (!row.discarded && row.symbol === symbol ? 1 : 0) >
    0;
  // A row a document lists under an account names none of the user's until
  // the review picks one.
  const unrouted = (row: EditedRow) =>
    row.accountLabel !== undefined && row.accountId === undefined;
  const valid = parsed.every(
    (each) =>
      each.row.discarded ||
      (!quantityInvalid(each.row, each.quantity) &&
        each.row.symbol !== "" &&
        !unrouted(each.row) &&
        !severalCash(each.row) &&
        !listedElsewhere(each.row, each.row.symbol) &&
        !priceInvalid(each) &&
        !costInvalid(each)),
  );
  const finalRows: ImportRow[] = parsed.map(
    ({ row, quantity, price, cost }) => ({
      id: row.id,
      ...(isCash(row) && { assetClass: "cash" as const }),
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
    finalRows.map((row, index) => ({
      symbol:
        row.discarded || row.symbol === ""
          ? ""
          : keyOf(rows[index]!, row.symbol),
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
      .filter(
        (row) =>
          !row.discarded && !isCash(row) && accountOf(row) === item.accountId,
      )
      .map((row) => row.symbol),
  );
  const omitted = [...held.keys()].filter((symbol) => !kept.has(symbol));
  const noun = fileNoun(item.origin);

  const change = (id: string, patch: Partial<EditedRow>) =>
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    );

  function confirm() {
    if (!valid) {
      setAlert(invalidRowsAlert(item.origin));
      return;
    }
    setAlert(undefined);
    startTransition(async () => {
      const result = await settle(
        actions.confirm(item.id, finalRows, heldCash),
      );
      if (result !== "rejected" && result.ok) {
        toast.success(savedToast("lo", item, institution));
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
    <div className="grid gap-4">
      <PageCrumbs
        crumbs={[{ label: "Cargar", href: backHref }, { label: item.fileName }]}
      />
      <div className="flex min-h-7 flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="sr-only">Revisá lo que leímos</h1>
        <p className="text-muted-foreground text-xs">
          {institution}
          {item.documentDate && ` · al ${formatDate(item.documentDate)}`}
        </p>
        {dateIssue && (
          <p className="flex items-center gap-1.5 text-xs">
            <TriangleAlert aria-hidden className="text-warn size-3.5" />
            {DATE_ISSUE_LABELS[dateIssue]}
          </p>
        )}
      </div>

      {item.skippedRows > 0 && (
        <LeftOutNotice>{skippedLine(item)}</LeftOutNotice>
      )}

      {item.origin !== "sync" && (
        <Notice
          aria-label="Totales"
          variant={
            matches === true
              ? "success"
              : matches === false
                ? "warning"
                : "info"
          }
          title={
            matches === "none"
              ? `${item.origin === "sheet" ? "La planilla" : "El documento"} no muestra un total para comparar: revisá las filas.`
              : matches
                ? `Lo leído suma lo mismo que ${noun}.`
                : `Lo leído no suma lo mismo que ${noun}: revisá las filas dudosas.`
          }
        >
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
                  {item.origin === "sheet" ? "Planilla" : "Documento"}
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
                        <MissingFigure text={`Sin total en ${noun}`} />
                      ) : (
                        formatAmount(printed, currency)
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Notice>
      )}

      <section className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">
            {holdingsCountText(rows.filter((row) => !row.discarded).length)}
            {doubtful > 0 && (
              <Badge variant="warning" className="ml-2 align-middle">
                {countOf(doubtful, "dudosa", "dudosas")}
              </Badge>
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
            const effect = changeOf(row, quantity);
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
                    "border-warn/50 bg-warn/5",
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
                      onAdded={addToCatalog}
                      markets={marketsFor(institution)}
                      lines
                      line={lineOf(
                        instruments.find((each) => each.symbol === row.symbol),
                        row.currency,
                      )}
                      onChange={(symbol, added, line) =>
                        change(
                          row.id,
                          pickedInstrument(
                            row.currency,
                            symbol,
                            added ? [...instruments, added] : instruments,
                            line,
                          ),
                        )
                      }
                      placeholder="Elegí un activo"
                    />
                  ) : (
                    <span className="truncate font-medium">
                      {isCash(row)
                        ? unlabeledName(ASSET_CLASS_LABELS.cash, row.currency)
                        : instrumentLabel(row.symbol, names.get(row.symbol))}
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
                      className="flex items-center gap-1 text-xs"
                    >
                      <TriangleAlert aria-hidden className="text-warn size-3" />
                      {issueLabel(issue, isCash(row))}
                    </span>
                  ))}
                  {!row.discarded && severalCash(row) && (
                    <span className="flex items-center gap-1 text-xs">
                      <TriangleAlert aria-hidden className="text-warn size-3" />
                      Tenés varios saldos en esta moneda en la cuenta: descartá
                      la fila y actualizalos a mano.
                    </span>
                  )}
                </div>
                {row.accountLabel !== undefined && accounts && (
                  <label className="grid gap-1 text-xs sm:col-span-4">
                    <span className="text-muted-foreground">
                      {`Cuenta · ${noun} dice "${row.accountLabel}"`}
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
                  <span className="text-muted-foreground">
                    {isCash(row) ? `Monto (${row.currency})` : "Cantidad"}
                  </span>
                  <Input
                    value={row.quantityText}
                    aria-label={`${isCash(row) ? "Monto" : "Cantidad"} de la fila ${index + 1}`}
                    inputMode="decimal"
                    disabled={row.discarded}
                    aria-invalid={
                      !row.discarded && quantityInvalid(row, quantity)
                    }
                    onChange={(event) =>
                      change(row.id, { quantityText: event.target.value })
                    }
                  />
                </label>
                {isCash(row) ? (
                  <span aria-hidden className="hidden sm:block" />
                ) : (
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
                )}
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
                  !isCash(row) &&
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
          <h2 id={`${pickerId}-omitted`} className="text-sm font-semibold">
            {item.origin === "sync"
              ? "No vinieron en la sincronización"
              : item.origin === "sheet"
                ? "No figuran en la planilla"
                : "No figuran en el resumen"}
          </h2>
          <p className="text-muted-foreground text-xs">
            {item.origin === "sync"
              ? "Los tenés en la cuenta y la sincronización no los trajo: quedan como están."
              : `Los tenés en la cuenta y ${noun} no los lista: quedan como están.`}
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
