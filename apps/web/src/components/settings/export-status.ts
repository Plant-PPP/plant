import type { ExportTable } from "@/lib/export/csv";
import type { ExportAnswer } from "@/lib/export/tables";

export type ExportOutcome =
  | { kind: "step_up" }
  | { kind: "failed"; notice: string }
  | { kind: "save"; tables: readonly ExportTable[]; notice: string | null };

export const EXPORT_FAILED = "No pudimos armar el archivo. Probá de nuevo.";
export const EXPORT_PARTIAL =
  "El archivo quedó incompleto: tenés más datos de los que entran en una descarga.";

// What the card does with an export's answer: ask for the step-up, say it
// failed, or save the file, saying when it is partial.
export function exportOutcome(answer: ExportAnswer): ExportOutcome {
  if (answer === null) return { kind: "failed", notice: EXPORT_FAILED };
  if ("stepUp" in answer) return { kind: "step_up" };
  return {
    kind: "save",
    tables: answer.tables,
    notice: answer.truncated ? EXPORT_PARTIAL : null,
  };
}
