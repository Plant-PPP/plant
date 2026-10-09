"use client";

import { Plus } from "lucide-react";
import { useId, useRef, useState, useTransition } from "react";
import { AppDialog } from "@/components/ui/app-dialog";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { FormAlert } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  CHOICE_MESSAGES,
  WRITE_MESSAGES,
} from "@/lib/portfolio-setup/messages";
import { normalizeName } from "@/lib/portfolio-setup/normalize-name";
import type {
  HolderRow,
  PortfolioRow,
  SourceConnectionRow,
} from "@/lib/portfolio-setup/read";
import type { WriteResult } from "@/lib/portfolio-setup/write-result";
import { settle } from "@/lib/server-action-call";
import { dialogAnswer } from "./answers";
import { NewHolderField } from "./new-holder-field";

// Suggestions only: any institution can be typed.
const INSTITUTIONS = [
  "Allaria",
  "Balanz",
  "Banco Galicia",
  "Banco Macro",
  "Banco Nación",
  "Banco Santander",
  "BBVA",
  "Binance",
  "Brubank",
  "Bull Market",
  "Cocos",
  "IEB",
  "IOL",
  "Lemon",
  "Mercado Pago",
  "Naranja X",
  "PPI",
  "Ualá",
];

export type SourceConnectionFields = {
  institution: string;
  holder: string;
  includeInTaxReport: boolean;
  defaultPortfolioId: string;
};

// The dialog's starting values. An archived holder or portfolio starts
// unselected, so a restore makes the user choose an active one.
export function initialFields(
  row: SourceConnectionRow | null,
  portfolios: PortfolioRow[],
): SourceConnectionFields {
  if (!row) {
    return {
      institution: "",
      holder: "self",
      includeInTaxReport: true,
      // The oldest active portfolio, "Principal" unless the user archived it.
      defaultPortfolioId: portfolios.at(-1)?.id ?? "",
    };
  }
  return {
    institution: row.institution,
    holder: row.holder ? (row.holder.archived ? "" : row.holder.id) : "self",
    includeInTaxReport: row.includeInTaxReport,
    defaultPortfolioId: row.portfolio.archived ? "" : row.portfolio.id,
  };
}

// The select left unchosen, which a restore starts with when the account's
// holder or portfolio was archived.
export function missingChoice(
  fields: SourceConnectionFields,
): "holder" | "portfolio" | undefined {
  if (fields.holder === "") return "holder";
  if (fields.defaultPortfolioId === "") return "portfolio";
  return undefined;
}

// Radix's hidden native select reports "" when the value is set before its
// option renders, as for a holder just created here; no option is "".
function choose(set: (value: string) => void) {
  return (value: string) => {
    if (value !== "") set(value);
  };
}

// Creates, edits or restores an account. A new holder can be added from the
// dialog without leaving it: its field has no form of its own, so Enter there
// saves the holder and never the account.
export function SourceConnectionDialog({
  title,
  description,
  submitLabel,
  initial,
  holders,
  portfolios,
  returnFocusTo,
  onClose,
  onSubmit,
  onSaved,
}: {
  title: string;
  description: string;
  submitLabel: string;
  initial: SourceConnectionFields;
  holders: HolderRow[];
  portfolios: PortfolioRow[];
  returnFocusTo: () => HTMLElement | null;
  onClose: () => void;
  onSubmit: (fields: SourceConnectionFields) => Promise<WriteResult>;
  onSaved: (institution: string) => void;
}) {
  const ids = {
    institution: useId(),
    institutions: useId(),
    holder: useId(),
    portfolio: useId(),
    tax: useId(),
    alert: useId(),
  };
  const [holder, setHolder] = useState(initial.holder);
  const [portfolio, setPortfolio] = useState(initial.defaultPortfolioId);
  const [includeInTaxReport, setIncludeInTaxReport] = useState(
    initial.includeInTaxReport,
  );
  // Holders created here, until the page's refresh lists them.
  const [added, setAdded] = useState<HolderRow[]>([]);
  const [addingHolder, setAddingHolder] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const institution = useRef<HTMLInputElement>(null);
  const holderTrigger = useRef<HTMLButtonElement>(null);
  const portfolioTrigger = useRef<HTMLButtonElement>(null);
  const saved = useRef(false);

  const holderOptions = [
    ...holders,
    ...added.filter((row) => !holders.some(({ id }) => id === row.id)),
  ];

  // The submit button is aria-disabled while pending, not disabled: a
  // disabled button drops its focus to the page.
  function submit() {
    if (pending) return;
    const fields = {
      institution: institution.current?.value ?? "",
      holder,
      includeInTaxReport,
      defaultPortfolioId: portfolio,
    };
    const missing = missingChoice(fields);
    if (missing) {
      setError(CHOICE_MESSAGES[missing]);
      (missing === "holder"
        ? holderTrigger
        : portfolioTrigger
      ).current?.focus();
      return;
    }
    setError(undefined);
    startTransition(async () => {
      const answer = dialogAnswer(
        await settle(onSubmit(fields)),
        WRITE_MESSAGES.source_connections,
      );
      if (answer.kind === "done") {
        saved.current = true;
        onSaved(normalizeName(fields.institution));
        onClose();
      } else {
        setError(answer.text);
      }
    });
  }

  return (
    <AppDialog
      onOpenChange={(open) => !open && !pending && onClose()}
      title={title}
      description={description}
      returnFocusTo={(opener) =>
        saved.current || !opener ? returnFocusTo() : opener
      }
    >
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="grid gap-5">
          <div className="grid gap-2">
            <Label htmlFor={ids.institution}>Institución</Label>
            <Input
              ref={institution}
              id={ids.institution}
              list={ids.institutions}
              defaultValue={initial.institution}
              autoComplete="off"
              autoFocus
              required
            />
            <datalist id={ids.institutions}>
              {INSTITUTIONS.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </div>

          <div className="grid gap-2">
            <Label htmlFor={ids.holder}>Titular</Label>
            <div className="flex gap-2">
              <Select value={holder} onValueChange={choose(setHolder)}>
                <SelectTrigger
                  ref={holderTrigger}
                  id={ids.holder}
                  className="min-w-0 flex-1"
                  aria-invalid={error && !holder ? true : undefined}
                >
                  <SelectValue placeholder="Elegí un titular" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="self">Vos</SelectItem>
                  {holderOptions.map((row) => (
                    <SelectItem key={row.id} value={row.id}>
                      {row.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!addingHolder && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setAddingHolder(true)}
                >
                  <Plus />
                  Nuevo titular
                </Button>
              )}
            </div>
            {addingHolder && (
              <NewHolderField
                onCreated={(row) => {
                  setAdded((rows) => [...rows, row]);
                  setHolder(row.id);
                  setAddingHolder(false);
                  holderTrigger.current?.focus();
                }}
                onCancel={() => {
                  setAddingHolder(false);
                  holderTrigger.current?.focus();
                }}
              />
            )}
          </div>

          <div className="grid gap-2">
            <Label htmlFor={ids.portfolio}>Cartera por defecto</Label>
            <Select value={portfolio} onValueChange={choose(setPortfolio)}>
              <SelectTrigger
                ref={portfolioTrigger}
                id={ids.portfolio}
                className="w-full"
                aria-invalid={error && !portfolio ? true : undefined}
              >
                <SelectValue placeholder="Elegí una cartera" />
              </SelectTrigger>
              <SelectContent>
                {portfolios.map((row) => (
                  <SelectItem key={row.id} value={row.id}>
                    {row.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Adonde van las inversiones que cargues de esta cuenta.
            </p>
          </div>

          <div className="flex items-center justify-between gap-4">
            <Label htmlFor={ids.tax}>Incluir en el reporte</Label>
            <Switch
              id={ids.tax}
              checked={includeInTaxReport}
              onCheckedChange={setIncludeInTaxReport}
            />
          </div>

          {error && <FormAlert id={ids.alert}>{error}</FormAlert>}
        </div>
        <DialogFooter>
          <Button
            type="submit"
            aria-disabled={pending}
            aria-describedby={error ? ids.alert : undefined}
            className="aria-disabled:opacity-50"
          >
            {pending ? "Guardando…" : submitLabel}
          </Button>
        </DialogFooter>
      </form>
    </AppDialog>
  );
}
