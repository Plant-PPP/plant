"use client";

import {
  ArrowLeftRight,
  Check,
  HandCoins,
  Landmark,
  Wallet,
  X,
  Home,
} from "lucide-react";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import type { ProposalState, ProposalView } from "@/lib/assistant/proposals";
import { cn } from "@/lib/utils";

const ICONS = {
  debt: HandCoins,
  account: Landmark,
  holdings: Wallet,
  operations: ArrowLeftRight,
  real_estate: Home,
} as const;
const KIND_LABELS = {
  debt: "Deuda",
  account: "Cuenta",
  holdings: "Tenencias",
  operations: "Operaciones",
  real_estate: "Inmueble",
} as const;
// Holdings and operations are confirmed in their review, not on the card.
const STAGED = new Set<ProposalView["kind"]>(["holdings", "operations"]);

const STATE_LABELS: Record<Exclude<ProposalState, "pending">, string> = {
  confirmed: "Cargada",
  declined: "Descartada",
};

// One thing the assistant proposes to load: what it is, and Confirmar or
// Descartar. `onAnswer` writes the answer and says whether it was kept; the
// card shows it at once and goes back if it was not.
export function ProposalCard({
  proposal,
  onAnswer,
}: {
  proposal: ProposalView;
  onAnswer?: (decision: "confirm" | "decline") => Promise<boolean>;
}) {
  const [state, setState] = useState<ProposalState>(proposal.state);
  const [pending, startTransition] = useTransition();
  const Icon = ICONS[proposal.kind];
  const answer = (decision: "confirm" | "decline") =>
    startTransition(async () => {
      if (!onAnswer) return;
      const kept = await onAnswer(decision);
      if (kept) setState(decision === "confirm" ? "confirmed" : "declined");
    });

  return (
    <div
      className={cn(
        "border-primary/20 bg-muted/40 grid gap-3 rounded-lg border p-3 text-[13px]",
        state !== "pending" && "opacity-70",
      )}
    >
      <div className="flex items-start gap-2.5">
        <Icon aria-hidden className="text-primary mt-0.5 size-4 shrink-0" />
        <div className="grid min-w-0 gap-0.5">
          <p className="text-muted-foreground text-xs">
            {KIND_LABELS[proposal.kind]}
          </p>
          <p className="font-medium">{proposal.title}</p>
          {proposal.lines.map((line) => (
            <p key={line} className="text-muted-foreground text-xs">
              {line}
            </p>
          ))}
        </div>
      </div>
      {state === "pending" ? (
        onAnswer && (
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => answer("decline")}
            >
              <X aria-hidden />
              Descartar
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={pending}
              onClick={() => answer("confirm")}
            >
              <Check aria-hidden />
              {STAGED.has(proposal.kind) ? "Revisar y cargar" : "Confirmar"}
            </Button>
          </div>
        )
      ) : (
        <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
          {state === "confirmed" ? (
            <Check aria-hidden className="text-gain size-3.5" />
          ) : (
            <X aria-hidden className="size-3.5" />
          )}
          {state === "confirmed" && STAGED.has(proposal.kind)
            ? "Enviada a Cargar"
            : STATE_LABELS[state]}
        </p>
      )}
    </div>
  );
}
