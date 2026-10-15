"use client";

import { Download, FileSpreadsheet, LogIn } from "lucide-react";
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

import { loginPath } from "@/lib/auth/routes";
import { SIGN_OUT_FAILED, signOutAndConfirm } from "@/lib/auth/sign-out";
import { type ExportTable, toCsv } from "@/lib/export/csv";
import { csvBlob, saveFile } from "@/lib/export/download";
import { EXPORT_KINDS, type ExportAnswer } from "@/lib/export/tables";
import { xlsxBlob } from "@/lib/export/xlsx";
import { SETTINGS_ITEM } from "@/lib/navigation";
import { settle } from "@/lib/server-action-call";
import { createClient } from "@/lib/supabase/client";

import { EXPORT_FAILED, exportOutcome } from "./export-status";

// Everything the user loaded: one CSV per kind of row, or all of them as one
// Excel workbook. The tables are read only when the user asks for a file, and
// only after a recent sign-in; the step-up signs out and comes back here.
export function ExportCard({ load }: { load: () => Promise<ExportAnswer> }) {
  const [busy, setBusy] = useState(false);
  const [stepUp, setStepUp] = useState(false);

  async function save(file: (tables: readonly ExportTable[]) => Promise<void>) {
    setBusy(true);
    const answer = await settle(load());
    try {
      const outcome = exportOutcome(answer === "rejected" ? null : answer);
      if (outcome.kind === "step_up") setStepUp(true);
      else if (outcome.kind === "failed") toast.error(outcome.notice);
      else {
        await file(outcome.tables);
        if (outcome.notice) toast.warning(outcome.notice);
      }
    } catch {
      toast.error(EXPORT_FAILED);
    } finally {
      setBusy(false);
    }
  }

  async function signInAgain() {
    setBusy(true);
    if (await signOutAndConfirm(createClient().auth)) {
      window.location.assign(loginPath(SETTINGS_ITEM.href));
      return;
    }
    setBusy(false);
    toast.error(SIGN_OUT_FAILED);
  }

  return (
    <Card className="max-w-3xl gap-0">
      <CardHeader className="border-b">
        <CardTitle className="text-lg">Tus datos</CardTitle>
        <CardDescription>
          {stepUp
            ? "Por seguridad, volvé a ingresar para bajar tus datos. Vamos a cerrar tu sesión en este dispositivo."
            : "Bajá todo lo que cargaste en un Excel, o en archivos CSV que abre cualquier planilla."}
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-6 flex flex-wrap gap-2">
        {stepUp ? (
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={() => void signInAgain()}
          >
            <LogIn />
            Volver a ingresar
          </Button>
        ) : (
          <>
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
                    const table = tables.find(
                      (each) => each.name === kind.name,
                    );
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
          </>
        )}
      </CardContent>
    </Card>
  );
}
