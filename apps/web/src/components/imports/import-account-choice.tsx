"use client";

import { Building2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import { PageCrumbs } from "@/components/layout/page-crumbs";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { PageButton } from "@/components/ui/page-button";
import { PageHeader } from "@/components/ui/page-header";
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
    <div className="grid gap-4">
      <PageCrumbs
        crumbs={[{ label: "Cargar", href: backHref }, { label: item.fileName }]}
      />
      {accounts.length === 0 ? (
        <>
          <h1 className="sr-only">¿De qué cuenta es?</h1>
          <EmptyState
            icon={Building2}
            title="Primero, una cuenta"
            actions={
              <PageButton asChild variant="default">
                <Link href="/accounts">Agregar una cuenta</Link>
              </PageButton>
            }
          >
            {`Leímos ${kind} de un broker en este archivo. Agregá la cuenta y volvé a esta carga para revisarlas.`}
          </EmptyState>
        </>
      ) : (
        <>
          <PageHeader
            title="¿De qué cuenta es?"
            filters={
              <>
                <Label htmlFor={`${id}-account`} className="sr-only">
                  Cuenta
                </Label>
                <Select
                  value={accountId}
                  onValueChange={(value) => value && setAccountId(value)}
                >
                  <SelectTrigger
                    id={`${id}-account`}
                    size="xs"
                    className="sm:min-w-48"
                  >
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
              </>
            }
            actions={
              <PageButton
                variant="default"
                disabled={!accountId || pending}
                onClick={choose}
              >
                Seguir
              </PageButton>
            }
          />
          <Notice title="¿De qué cuenta es?">
            {`Leímos ${kind} de un broker en este archivo. Elegí la cuenta para revisarlas.`}
          </Notice>
        </>
      )}
      {alert && <FormAlert>{alert}</FormAlert>}
    </div>
  );
}
