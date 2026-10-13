import type { TablePart } from "@/lib/assistant/chat";
import { formatAmount } from "@/lib/format/amount";
import { formatDate } from "@/lib/format/date";

// An answer's table: a row per item with its day, what it is and its value.
export function AnswerTable({ table }: { table: TablePart }) {
  return (
    <div className="grid gap-2 rounded-lg border p-3">
      <table className="w-full text-xs">
        <caption className="mb-2 text-left text-sm font-medium">
          {table.title}
        </caption>
        <thead className="text-muted-foreground text-left">
          <tr>
            <th scope="col" className="pb-1 font-normal">
              Fecha
            </th>
            <th scope="col" className="pb-1 font-normal">
              Qué
            </th>
            <th scope="col" className="pb-1 text-right font-normal">
              Monto
            </th>
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, index) => (
            <tr key={index} className="border-t">
              <td className="py-1 pr-2 tabular-nums">{formatDate(row.date)}</td>
              <td className="py-1 pr-2">{row.label}</td>
              <td className="py-1 text-right tabular-nums">
                {row.value === null
                  ? "Sin cotización"
                  : formatAmount(row.value, table.unit)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
