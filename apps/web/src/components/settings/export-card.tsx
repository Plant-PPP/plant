"use client";

import { Download, FileSpreadsheet } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { type ExportTable, toCsv } from "@/lib/export/csv";
import { csvBlob, saveFile } from "@/lib/export/download";
import { EXPORT_KINDS } from "@/lib/export/tables";
import { xlsxBlob } from "@/lib/export/xlsx";

// Everything the user loaded: one CSV per kind of row, or all of them as one
// Excel workbook. The tables are read only when the user asks for a file;
// null when they could not be.
export function ExportCard({
  load,
}: {
  load: () => Promise<readonly ExportTable[] | null>;
}) {
  const [busy, setBusy] = useState(false);

  async function save(file: (tables: readonly ExportTable[]) => Promise<void>) {
    setBusy(true);
    try {
      const tables = await load().catch(() => null);
      if (tables) await file(tables);
      else toast.error("No pudimos armar el archivo. Probá de nuevo.");
    } catch {
      toast.error("No pudimos armar el archivo. Probá de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tus datos</CardTitle>
        <CardDescription>
          Bajá todo lo que cargaste en un Excel, o en archivos CSV que abre
          cualquier planilla.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={busy}
          onClick={() =>
            void save(async (tables) =>
              saveFile("plant.xlsx", await xlsxBlob(tables)),
            )
          }
        >
          <FileSpreadsheet />
          Todo en Excel
        </Button>
        {EXPORT_KINDS.map((kind) => (
          <Button
            key={kind.name}
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() =>
              void save(async (tables) => {
                const table = tables.find((each) => each.name === kind.name);
                if (table) {
                  saveFile(
                    `${table.name}.csv`,
                    csvBlob(toCsv(table.header, table.rows)),
                  );
                }
              })
            }
          >
            <Download />
            {kind.label}
          </Button>
        ))}
      </CardContent>
    </Card>
  );
}
