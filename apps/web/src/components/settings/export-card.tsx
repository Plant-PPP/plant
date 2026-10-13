"use client";

import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import type { ExportFile } from "@/lib/export/csv";

// Hands the browser one file to save.
function download({ name, csv }: ExportFile) {
  // A byte order mark, so a spreadsheet reads the accents as UTF-8.
  const url = URL.createObjectURL(
    new Blob(["\uFEFF", csv()], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

// Everything the user loaded, one CSV per kind of row.
export function ExportCard({ files }: { files: readonly ExportFile[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Tus datos</CardTitle>
        <CardDescription>
          Bajá todo lo que cargaste, en archivos CSV que abre cualquier
          planilla.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {files.map((file) => (
          <Button
            key={file.name}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => download(file)}
          >
            <Download />
            {file.label}
          </Button>
        ))}
      </CardContent>
    </Card>
  );
}
