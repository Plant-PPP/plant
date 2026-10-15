"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ImportItem } from "@/lib/imports/review";
import type { AccountResult } from "@/lib/imports/write";

export type AccountChoiceActions = {
  assign: (input: {
    importId: string;
    accountId: string;
  }) => Promise<AccountResult>;
};

const REFUSED: Record<string, string> = {
  duplicate: "Ese archivo ya está cargado en esa cuenta.",
  not_found: "No encontramos esa cuenta o la carga. Volvé a Cargar.",
};

// A file uploaded to no account whose reading turned out to be holdings or
// operations: its review starts by asking which account they are of.
export function ImportAccountChoice({
  item,
  accounts,
  backHref,
  actions,
}: {
  item: ImportItem;
  accounts: readonly { id: string; institution: string }[];
  backHref: string;
  actions: AccountChoiceActions;
}) {
  const router = useRouter();
  const id = useId();
  const [accountId, setAccountId] = useState("");
  const [alert, setAlert] = useState<string>();
  const [pending, startTransition] = useTransition();
  const kind = item.operations ? "operaciones" : "tenencias";

  function choose() {
    if (!accountId) return;
    setAlert(undefined);
    startTransition(async () => {
      const result = await actions.assign({ importId: item.id, accountId });
      if (result.ok) router.refresh();
      else
        setAlert(
          REFUSED[result.code] ??
            "No pudimos guardar la cuenta. Probá de nuevo.",
        );
    });
  }

  return (
    <div className="grid gap-6">
      <div className="grid gap-3">
        <Link
          href={backHref}
          className="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1 text-sm"
        >
          <ArrowLeft aria-hidden className="size-4" />
          Cargar
        </Link>
        <div className="grid gap-1">
          <h1 className="text-xl font-semibold">¿De qué cuenta es?</h1>
          <p className="text-muted-foreground text-sm">
            {`Leímos ${kind} de un broker en ${item.fileName}. Elegí la cuenta para revisarlas.`}
          </p>
        </div>
      </div>

      {accounts.length === 0 ? (
        <p className="text-sm">
          Todavía no tenés cuentas.{" "}
          <Link href="/accounts" className="underline underline-offset-4">
            Agregá una
          </Link>{" "}
          y volvé a esta carga.
        </p>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid w-full gap-2 sm:w-64">
            <Label htmlFor={`${id}-account`}>Cuenta</Label>
            <Select
              value={accountId}
              onValueChange={(value) => value && setAccountId(value)}
            >
              <SelectTrigger id={`${id}-account`} className="w-full">
                <SelectValue placeholder="Elegí una cuenta" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((each) => (
                  <SelectItem key={each.id} value={each.id}>
                    {each.institution}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            type="button"
            disabled={!accountId || pending}
            onClick={choose}
          >
            Seguir
          </Button>
        </div>
      )}
      {alert && <FormAlert>{alert}</FormAlert>}
    </div>
  );
}
