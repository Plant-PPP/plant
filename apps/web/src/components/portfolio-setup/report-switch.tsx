"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

// An account's or an asset's "Incluir en el reporte", with an optional note,
// such as why an asset's account leaves it out anyway. aria-disabled keeps
// focus on it while a write runs.
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

// Why an asset's account choice leaves it out of the report anyway, linked to
// Cuentas, where each account's own switch is: the one account by name, or
// every account still holding it.
export function ExcludedAccountsNote({
  institutions,
  subject,
}: {
  institutions: readonly string[];
  // What is left out, as the sentence ends: "esta tenencia", "este activo".
  subject: string;
}) {
  return institutions.length === 1 ? (
    <>
      La cuenta{" "}
      <Link href="/accounts" className="underline">
        {institutions[0]}
      </Link>{" "}
      no se incluye en el reporte, así que {subject} tampoco.
    </>
  ) : (
    <>
      Las{" "}
      <Link href="/accounts" className="underline">
        cuentas
      </Link>{" "}
      donde lo tenés no se incluyen en el reporte, así que {subject} tampoco.
    </>
  );
}
