import type { ExportTable } from "@/lib/export/csv";
import { HOLDING_CLASS_LABELS } from "@/lib/holdings/classes";

import type { GainsKind, TaxReport } from "./report";

export const GAINS_LABELS: Record<GainsKind, string> = {
  sale_cedear: "Venta de CEDEARs",
  sale_bond: "Venta de bonos y ONs",
  sale_fci: "Rescate de FCIs",
  sale_crypto: "Venta de cripto",
  dividend: "Dividendos",
  coupon: "Cupones e intereses",
  yield: "Rendimientos (staking, earn)",
};

// The report as two tables: what was held at the year's end, and what sales
// and income gave over it. Amounts are plain decimals, as a spreadsheet reads
// them.
export function taxTables(report: TaxReport): ExportTable[] {
  return [
    {
      name: `bienes-personales-${report.year}`,
      label: "Bienes Personales",
      header: [
        "Activo",
        "Tipo",
        "Moneda",
        "Monto en su moneda",
        "Valuación en pesos",
        "Exento",
      ],
      rows: report.wealth.lines.map((line) => [
        line.name,
        HOLDING_CLASS_LABELS[line.holdingClass],
        line.currency,
        line.amount,
        line.ars,
        line.exempt ? "Sí" : "No",
      ]),
    },
    {
      name: `ganancias-${report.year}`,
      label: "Ganancias",
      header: ["Concepto", "Operaciones", "Resultado en pesos"],
      rows: report.gains.groups.map((group) => [
        GAINS_LABELS[group.kind],
        String(group.count),
        group.amount,
      ]),
    },
  ];
}
