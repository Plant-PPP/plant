"use client";

import { PageCrumbs } from "@/components/layout/page-crumbs";
import { LIABILITY_LABEL_MAX } from "@plant/core";
import { RotateCcw, TriangleAlert, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { LeftOutNotice } from "@/components/imports/left-out-notice";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { amountInput, parseAmountInput } from "@/lib/format/amount";
import { countOf } from "@/lib/format/text";
import { CURRENCY_LABELS, MOVEMENT_MESSAGES } from "@/lib/holdings/messages";
import type { MovementResult } from "@/lib/holdings/movements-input";
import {
  cardFor,
  debtsComplete,
  missingDebtFields,
  type ReviewedDebt,
} from "@/lib/imports/debts-review";
import {
  CONFIDENCE_LABELS,
  type ImportItem,
  lackingField,
  lackingFigure,
} from "@/lib/imports/review";
import { settle } from "@/lib/server-action-call";
import { cn } from "@/lib/utils";

export type DebtsReviewActions = {
  confirm: (id: string, rows: ReviewedDebt[]) => Promise<MovementResult>;
};

// One of the user's card debts a statement's debt may update.
export type CardDebt = {
  id: string;
  label: string;
  lender: string | null;
  currency: string | null;
};

const NEW = "new";
const NOT_A_NUMBER = "Ingresá un número válido";

// A debt as the user completes it: its figures as typed.
type EditedDebt = ReviewedDebt & {
  balanceText: string;
  minimumText: string;
};

// What the reading made of a card statement, for the user to complete before
// it goes into Deudas: each debt with what the statement does not say asked
// for, as a new card debt or one the user already has.
export function ImportDebtsReview({
  item,
  institution,
  cards,
  backHref,
  doneHref,
  actions,
}: {
  item: ImportItem;
  institution: string;
  cards: readonly CardDebt[];
  backHref: string;
  doneHref: string;
  actions: DebtsReviewActions;
}) {
  const router = useRouter();
  const listId = useId();
  const [rows, setRows] = useState<EditedDebt[]>(() => {
    // Each card debt is proposed for one debt of the statement at most.
    const proposed = new Set<string>();
    return (item.debts ?? []).map((debt) => {
      const card = cardFor(debt, cards);
      const liabilityId = card !== null && !proposed.has(card) ? card : null;
      if (liabilityId) proposed.add(liabilityId);
      return {
        ...debt,
        liabilityId,
        balanceText: debt.balance === null ? "" : amountInput(debt.balance),
        minimumText:
          debt.minimumPayment === null ? "" : amountInput(debt.minimumPayment),
      };
    });
  });
  const [alert, setAlert] = useState<string>();
  const [pending, startTransition] = useTransition();

  const finals: ReviewedDebt[] = rows.map(
    ({ balanceText, minimumText, ...row }) => ({
      ...row,
      label: row.label?.trim() || null,
      lender: row.lender?.trim() || null,
      balance: parseAmountInput(balanceText),
      minimumPayment: parseAmountInput(minimumText),
    }),
  );
  const missing = finals.map((row) => new Set(missingDebtFields(row)));
  const typedInvalid = (row: EditedDebt, text: string) =>
    !row.discarded && text.trim() !== "" && parseAmountInput(text) === null;
  const balanceInvalid = rows.map((row) => typedInvalid(row, row.balanceText));
  const minimumInvalid = rows.map((row) => typedInvalid(row, row.minimumText));
  const kept = finals.some((row) => !row.discarded);
  // The card debts the kept debts update: one debt each.
  const updated = finals.flatMap((row) =>
    row.discarded || row.liabilityId === null ? [] : [row.liabilityId],
  );
  const complete =
    debtsComplete(finals) &&
    minimumInvalid.every((each) => !each) &&
    new Set(updated).size === updated.length;

  const change = (id: string, patch: Partial<EditedDebt>) =>
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    );

  function confirm() {
    if (!complete) return;
    setAlert(undefined);
    startTransition(async () => {
      const result = await settle(actions.confirm(item.id, finals));
      if (result !== "rejected" && result.ok) {
        const count = finals.filter((row) => !row.discarded).length;
        toast.success(
          `Guardaste ${countOf(count, "deuda", "deudas")} de ${item.fileName}`,
        );
        router.push(doneHref);
        return;
      }
      setAlert(
        result === "rejected"
          ? MOVEMENT_MESSAGES.failed
          : result.code === "not_found"
            ? "Esta carga ya no está lista para confirmar, o la deuda que elegiste ya no existe. Volvé a Cargar."
            : MOVEMENT_MESSAGES[result.code],
      );
    });
  }

  return (
    <div className="grid gap-4">
      <PageCrumbs
        crumbs={[{ label: "Cargar", href: backHref }, { label: item.fileName }]}
      />
      <div className="flex min-h-7 flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="sr-only">Revisá las deudas que leímos</h1>
        {institution && (
          <p className="text-muted-foreground text-xs">{institution}</p>
        )}
      </div>

      {item.skippedRows > 0 && (
        <LeftOutNotice>
          {item.skippedRows === 1
            ? "Una deuda quedó afuera: revisala en el resumen antes de confirmar."
            : `${item.skippedRows} deudas quedaron afuera: revisalas en el resumen antes de confirmar.`}
        </LeftOutNotice>
      )}

      <section className="grid gap-3" aria-labelledby={`${listId}-list`}>
        <h2 id={`${listId}-list`} className="text-sm font-semibold">
          {countOf(rows.length, "deuda", "deudas")}
        </h2>
        <ul className="grid gap-2">
          {rows.map((row, index) => {
            const options = cards.filter(
              (card) =>
                card.currency === row.currency &&
                (card.id === row.liabilityId || !updated.includes(card.id)),
            );
            const problem = (field: "label" | "balance") =>
              !row.discarded && missing[index]!.has(field);
            return (
              <li
                key={row.id}
                aria-label={`Deuda ${index + 1}`}
                className={cn(
                  "grid gap-3 rounded-lg border p-3",
                  !row.discarded &&
                    (missing[index]!.size > 0 || row.confidence === "low") &&
                    "border-warn/50 bg-warn/5",
                  row.discarded && "opacity-50",
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="grid min-w-0 gap-1">
                    <span className="truncate font-medium">
                      {`${(item.debts ?? [])[index]?.label ?? "Tarjeta"} · ${CURRENCY_LABELS[row.currency]}`}
                    </span>
                    <span className="text-muted-foreground flex flex-wrap gap-x-2 text-xs">
                      <span>{row.source}</span>
                      <span>{`Confianza ${CONFIDENCE_LABELS[row.confidence].toLowerCase()}`}</span>
                    </span>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={`${row.discarded ? "Recuperar" : "Descartar"} la deuda ${index + 1}`}
                    onClick={() =>
                      change(row.id, { discarded: !row.discarded })
                    }
                  >
                    {row.discarded ? <RotateCcw /> : <X />}
                    {row.discarded ? "Recuperar" : "Descartar"}
                  </Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="grid gap-1 text-xs sm:col-span-3">
                    <span className="text-muted-foreground">Deuda</span>
                    <Select
                      value={row.liabilityId ?? NEW}
                      disabled={row.discarded}
                      onValueChange={(value) =>
                        change(row.id, {
                          liabilityId: value === NEW ? null : value,
                        })
                      }
                    >
                      <SelectTrigger
                        aria-label={`A qué deuda va la deuda ${index + 1}`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NEW}>
                          Nueva deuda de tarjeta
                        </SelectItem>
                        {options.map((card) => (
                          <SelectItem key={card.id} value={card.id}>
                            {`Actualizar ${[card.label, card.lender].filter(Boolean).join(" · ")}`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                  {row.liabilityId === null && (
                    <>
                      <label className="grid gap-1 text-xs">
                        <span className="text-muted-foreground">Nombre</span>
                        <Input
                          value={row.label ?? ""}
                          maxLength={LIABILITY_LABEL_MAX}
                          aria-label={`Nombre de la deuda ${index + 1}`}
                          aria-invalid={problem("label") || undefined}
                          disabled={row.discarded}
                          onChange={(event) =>
                            change(row.id, { label: event.target.value })
                          }
                        />
                        {problem("label") && (
                          <Problem
                            text={lackingField(
                              item.debts?.[index]?.label ?? null,
                              item.origin,
                            )}
                          />
                        )}
                      </label>
                      <label className="grid gap-1 text-xs">
                        <span className="text-muted-foreground">
                          Emisor · Opcional
                        </span>
                        <Input
                          value={row.lender ?? ""}
                          maxLength={LIABILITY_LABEL_MAX}
                          aria-label={`Emisor de la deuda ${index + 1}`}
                          disabled={row.discarded}
                          onChange={(event) =>
                            change(row.id, { lender: event.target.value })
                          }
                        />
                      </label>
                    </>
                  )}
                  <label className="grid gap-1 text-xs">
                    <span className="text-muted-foreground">
                      {`Saldo (${row.currency})`}
                    </span>
                    <Input
                      value={row.balanceText}
                      inputMode="decimal"
                      aria-label={`Saldo de la deuda ${index + 1}`}
                      aria-invalid={problem("balance") || undefined}
                      disabled={row.discarded}
                      onChange={(event) =>
                        change(row.id, { balanceText: event.target.value })
                      }
                    />
                    {balanceInvalid[index] ? (
                      <Problem text={NOT_A_NUMBER} />
                    ) : (
                      problem("balance") && (
                        <Problem
                          text={lackingFigure(
                            row.balanceText,
                            row.balance,
                            item.origin,
                            "amount",
                          )}
                        />
                      )
                    )}
                  </label>
                  <label className="grid gap-1 text-xs">
                    <span className="text-muted-foreground">
                      {`Pago mínimo (${row.currency}) · Opcional`}
                    </span>
                    <Input
                      value={row.minimumText}
                      inputMode="decimal"
                      aria-label={`Pago mínimo de la deuda ${index + 1}`}
                      aria-invalid={minimumInvalid[index] || undefined}
                      disabled={row.discarded}
                      onChange={(event) =>
                        change(row.id, { minimumText: event.target.value })
                      }
                    />
                    {minimumInvalid[index] && <Problem text={NOT_A_NUMBER} />}
                  </label>
                  <label className="grid gap-1 text-xs">
                    <span className="text-muted-foreground">
                      Vencimiento · Opcional
                    </span>
                    <Input
                      type="date"
                      value={row.dueDate ?? ""}
                      aria-label={`Vencimiento de la deuda ${index + 1}`}
                      disabled={row.discarded}
                      onChange={(event) =>
                        change(row.id, {
                          dueDate: event.target.value || null,
                        })
                      }
                    />
                  </label>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {alert && <FormAlert>{alert}</FormAlert>}

      <div className="flex flex-wrap items-center justify-end gap-3">
        {!complete && (
          <span className="text-muted-foreground text-xs">
            {kept
              ? "Completá los datos que faltan para confirmar."
              : "Dejá al menos una deuda."}
          </span>
        )}
        <Button asChild variant="ghost">
          <Link href={backHref}>Después</Link>
        </Button>
        <Button type="button" disabled={!complete || pending} onClick={confirm}>
          Confirmar deudas
        </Button>
      </div>
    </div>
  );
}

function Problem({ text }: { text: string }) {
  return (
    <span className="flex items-center gap-1 text-xs">
      <TriangleAlert aria-hidden className="text-warn size-3" />
      {text}
    </span>
  );
}
