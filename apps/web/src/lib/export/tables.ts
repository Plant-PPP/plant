import {
  compareLiabilityEvents,
  isTrade,
  type Liability,
  type LiabilityEvent,
  liabilitiesToday,
} from "@plant/core";
import { exactOf, plus, stored } from "@plant/shared";

import { LIABILITY_KIND_LABELS, unitOf } from "@/components/debts/debt-fields";
import {
  ASSET_CLASS_LABELS,
  MOVEMENT_KIND_LABELS,
} from "@/lib/holdings/messages";
import type { HoldingRow } from "@/lib/holdings/read";
import type { ImportItem } from "@/lib/imports/review";
import { IMPORT_STATUS_LABELS } from "@/lib/imports/review";
import { allRows, type Ledger } from "@/lib/ledger/ledger";

import type { ExportTable } from "./csv";

// What an export is built from: the ledger, the holdings it does not carry
// (the real ledger has instruments only), the debts and the imports.
export type ExportData = Ledger & {
  otherHoldings?: readonly HoldingRow[];
  liabilities: readonly Liability[];
  liabilityEvents: ReadonlyMap<string, readonly LiabilityEvent[]>;
  imports: readonly ImportItem[];
};

// What an export answers: its tables and whether any was cut, the step-up it
// needs first, or null when it could not be read.
export type ExportAnswer =
  | { tables: ExportTable[]; truncated: boolean }
  | { stepUp: "sign_in_again" }
  | { limited: true }
  | null;

// The tables an export has, in order, by file name and what the page calls
// them.
export const EXPORT_KINDS = [
  { name: "tenencias", label: "Tenencias" },
  { name: "movimientos", label: "Movimientos" },
  { name: "deudas", label: "Deudas" },
  { name: "eventos-de-deudas", label: "Eventos de deudas" },
  { name: "cargas", label: "Cargas" },
] as const;

const [HOLDINGS, MOVEMENTS, DEBTS, DEBT_EVENTS, IMPORTS] = EXPORT_KINDS;

const DEBT_EVENT_LABELS: Record<LiabilityEvent["kind"], string> = {
  rate_change: "Cambio de tasa",
  payment: "Pago",
  adjustment: "Ajuste de saldo",
};

const yesNo = (on: boolean) => (on ? "Sí" : "No");

// Everything the user loaded, one table per kind of row, amounts as stored
// (a point before the decimals) so any spreadsheet reads them back.
export function exportTables(data: ExportData): ExportTable[] {
  const rows = [...allRows(data), ...(data.otherHoldings ?? [])];
  const byId = new Map(rows.map((row) => [row.id, row]));
  const account = (id: string) =>
    data.accounts.find((each) => each.id === id)?.institution ??
    data.archivedAccounts.find((each) => each.id === id)?.institution ??
    null;
  const closed = new Set(
    data.holdings.filter((each) => each.closed).map((each) => each.holding.id),
  );

  const holdings: ExportTable = {
    ...HOLDINGS,
    header: [
      "Cuenta",
      "Cartera",
      "Tipo",
      "Instrumento",
      "Cantidad o monto",
      "Moneda",
      "Tasa anual",
      "Desde",
      "Vence",
      "Valuado el",
      "Nombre",
      "Vendida",
    ],
    rows: rows.map(({ id, holding, account, portfolio }) => [
      account.institution,
      portfolio.name,
      ASSET_CLASS_LABELS[holding.asset_class],
      holding.instrument_symbol,
      // A holding sold to zero holds nothing.
      closed.has(id) ? "0" : holding.amount,
      holding.currency,
      holding.annual_rate,
      holding.started_on,
      holding.matures_on,
      holding.valued_on,
      holding.label,
      yesNo(closed.has(id)),
    ]),
  };

  const movements: ExportTable = {
    ...MOVEMENTS,
    header: [
      "Fecha",
      "Cuenta",
      "Cartera",
      "Instrumento",
      "Tipo",
      "Sentido",
      "Cantidad",
      "Precio",
      "Monto",
      "Moneda",
      "Gastos",
      "Referencia",
      "Nota",
    ],
    rows: [...data.movements.values()]
      .flat()
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((movement) => {
        const row = byId.get(movement.holding_id);
        const charges = movement.charges.reduce(
          (sum, charge) => plus(sum, exactOf(charge.amount)),
          exactOf("0"),
        );
        return [
          movement.date,
          row?.account.institution ?? null,
          row?.portfolio.name ?? null,
          row?.holding.instrument_symbol ?? null,
          MOVEMENT_KIND_LABELS[movement.kind],
          "direction" in movement
            ? movement.direction === "in"
              ? "Entrada"
              : "Salida"
            : null,
          isTrade(movement) ? movement.quantity : null,
          "price" in movement ? movement.price : null,
          "amount" in movement ? movement.amount : null,
          movement.currency,
          movement.charges.length > 0 ? stored(charges) : null,
          movement.reference,
          movement.note,
        ];
      }),
  };

  const today = new Map(
    liabilitiesToday(data.liabilities, data.liabilityEvents, data.today).map(
      (debt) => [debt.id, debt],
    ),
  );
  const debts: ExportTable = {
    ...DEBTS,
    header: [
      "Tipo",
      "Nombre",
      "Acreedor",
      "Moneda",
      "UVA",
      "Instrumento",
      "Saldo hoy",
      "Saldo inicial",
      "Saldo al",
      "Acumula interés",
      "Cuota",
      "Tasa hoy",
      "Tasa inicial",
      "Cuotas restantes",
      "Próximo vencimiento",
      "Vence",
    ],
    rows: data.liabilities.map((debt) => [
      LIABILITY_KIND_LABELS[debt.kind],
      debt.label,
      debt.lender,
      debt.currency,
      yesNo(debt.uva),
      debt.instrument_symbol,
      today.get(debt.id)!.balance,
      debt.balance,
      debt.anchored_on,
      yesNo(debt.accrues),
      debt.installment,
      today.get(debt.id)!.annual_rate,
      debt.annual_rate,
      debt.installments_left === null ? null : String(debt.installments_left),
      debt.next_due_on,
      debt.matures_on,
    ]),
  };

  const debtEvents: ExportTable = {
    ...DEBT_EVENTS,
    header: [
      "Deuda",
      "Fecha",
      "Evento",
      "Unidad",
      "Monto",
      "Tasa anual",
      "Cancela la deuda",
    ],
    // Each debt's events in the order they apply, debts as the sheet lists them.
    rows: data.liabilities.flatMap((debt) =>
      [...(data.liabilityEvents.get(debt.id) ?? [])]
        .sort(compareLiabilityEvents)
        .map((event) => [
          debt.label,
          event.date,
          DEBT_EVENT_LABELS[event.kind],
          unitOf(debt),
          event.amount,
          event.annual_rate,
          yesNo(event.settles),
        ]),
    ),
  };

  const imports: ExportTable = {
    ...IMPORTS,
    header: ["Fecha", "Archivo", "Cuenta", "Estado", "Fecha del resumen"],
    rows: data.imports.map((item) => [
      item.createdOn,
      item.fileName,
      item.accountId === null ? null : account(item.accountId),
      IMPORT_STATUS_LABELS[item.status],
      item.documentDate,
    ]),
  };

  return [holdings, movements, debts, debtEvents, imports];
}
