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
import { csvBlob, saveFile } from "@/lib/export/download";

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
            onClick={() => saveFile(file.name, csvBlob(file.csv()))}
          >
            <Download />
            {file.label}
          </Button>
        ))}
      </CardContent>
    </Card>
  );
}
