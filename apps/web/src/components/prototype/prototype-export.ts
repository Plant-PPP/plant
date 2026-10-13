import { isTrade } from "@plant/core";
import { exactOf, plus, stored } from "@plant/shared";

import { LIABILITY_KIND_LABELS } from "@/components/debts/debt-fields";
import { type ExportFile, toCsv } from "@/lib/export/csv";
import {
  ASSET_CLASS_LABELS,
  MOVEMENT_KIND_LABELS,
} from "@/lib/holdings/messages";
import { IMPORT_STATUS_LABELS } from "@/lib/imports/review";

import { allRows, type PrototypeState } from "./prototype-store";

const yesNo = (on: boolean) => (on ? "Sí" : "No");

// Everything the user loaded, one CSV per kind of row, amounts as stored
// (a point before the decimals) so any spreadsheet reads them back.
export function exportFiles(state: PrototypeState): ExportFile[] {
  const rows = allRows(state);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const account = (id: string) =>
    state.accounts.find((each) => each.id === id)?.institution ??
    state.archivedAccounts.find((each) => each.id === id)?.institution ??
    null;

  const holdings = () =>
    toCsv(
      [
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
      rows.map(({ id, holding, account, portfolio }) => [
        account.institution,
        portfolio.name,
        ASSET_CLASS_LABELS[holding.asset_class],
        holding.instrument_symbol,
        holding.amount,
        holding.currency,
        holding.annual_rate,
        holding.started_on,
        holding.matures_on,
        holding.valued_on,
        holding.label,
        yesNo(
          state.holdings.some((each) => each.holding.id === id && each.closed),
        ),
      ]),
    );

  const movements = () =>
    toCsv(
      [
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
      [...state.movements.values()]
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
    );

  const debts = () =>
    toCsv(
      [
        "Tipo",
        "Nombre",
        "Acreedor",
        "Moneda",
        "UVA",
        "Instrumento",
        "Saldo",
        "Cuota",
        "Tasa anual",
        "Cuotas restantes",
        "Próximo vencimiento",
        "Vence",
      ],
      state.liabilities.map((debt) => [
        LIABILITY_KIND_LABELS[debt.kind],
        debt.label,
        debt.lender,
        debt.currency,
        yesNo(debt.uva),
        debt.instrument_symbol,
        debt.balance,
        debt.installment,
        debt.annual_rate,
        debt.installments_left === null ? null : String(debt.installments_left),
        debt.next_due_on,
        debt.matures_on,
      ]),
    );

  const imports = () =>
    toCsv(
      ["Fecha", "Archivo", "Cuenta", "Estado", "Fecha del resumen"],
      state.imports.map((item) => [
        item.createdOn,
        item.fileName,
        account(item.accountId),
        IMPORT_STATUS_LABELS[item.status],
        item.documentDate,
      ]),
    );

  return [
    { name: "tenencias.csv", label: "Tenencias", csv: holdings },
    { name: "movimientos.csv", label: "Movimientos", csv: movements },
    { name: "deudas.csv", label: "Deudas", csv: debts },
    { name: "cargas.csv", label: "Cargas", csv: imports },
  ];
}
