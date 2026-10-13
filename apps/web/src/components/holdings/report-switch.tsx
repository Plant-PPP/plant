"use client";

import type { ReactNode } from "react";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

// An asset's "Incluir en el reporte", with the note that explains why its
// account leaves it out anyway. aria-disabled keeps focus on it while a write
// runs.
export function ReportSwitch({
  id,
  checked,
  onCheckedChange,
  pending = false,
  note,
}: {
  id: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  pending?: boolean;
  note?: ReactNode;
}) {
  const noteId = `${id}-note`;
  return (
    <div className="grid gap-1">
      <div className="flex items-center justify-between gap-4">
        <Label htmlFor={id}>Incluir en el reporte</Label>
        <Switch
          id={id}
          checked={checked}
          aria-disabled={pending || undefined}
          aria-describedby={note ? noteId : undefined}
          onCheckedChange={(next) => {
            if (!pending) onCheckedChange(next);
          }}
        />
      </div>
      {note && (
        <p id={noteId} className="text-xs text-muted-foreground">
          {note}
        </p>
      )}
    </div>
  );
}
