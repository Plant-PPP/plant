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
  accountLabel,
  CHOICE_MESSAGES,
  SELF_HOLDER_LABEL,
  WRITE_MESSAGES,
} from "@/lib/portfolio-setup/messages";
import { normalizeName } from "@/lib/portfolio-setup/normalize-name";
import type {
  HolderRow,
  PortfolioRow,
  SourceConnectionRow,
} from "@/lib/portfolio-setup/read";
import { SELF_HOLDER } from "@/lib/portfolio-setup/schemas";
import type { WriteResult } from "@/lib/portfolio-setup/write-result";
import { settle } from "@/lib/server-action-call";
import { dialogAnswer } from "./answers";
import { NewHolderField } from "./new-holder-field";
import { useSavedFocus } from "./saved-focus";
import { PendingButton } from "@/components/ui/pending-button";

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
      holder: SELF_HOLDER,
      includeInTaxReport: true,
      // The oldest active portfolio listed, the first one the user had unless
      // they archived it.
      defaultPortfolioId: portfolios.at(-1)?.id ?? "",
    };
  }
  return {
    institution: row.institution,
    holder: row.holder
      ? row.holder.archived
        ? ""
        : row.holder.id
      : SELF_HOLDER,
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
export function choose(set: (value: string) => void) {
  return (value: string) => {
    if (value !== "") set(value);
  };
}

// The holders to offer: the page's, then those created here that the page
// does not list yet.
export function holderChoices(
  holders: HolderRow[],
  added: HolderRow[],
): HolderRow[] {
  return [
    ...holders,
    ...added.filter((row) => !holders.some(({ id }) => id === row.id)),
  ];
}

// The holders created here still to offer once the page's list changes from
// `listed` to `holders`: one the page listed is the page's to offer, so one it
// stops listing, archived elsewhere, is not offered again.
export function pruneAdded(
  listed: HolderRow[],
  holders: HolderRow[],
  added: HolderRow[],
): HolderRow[] {
  return added.filter(
    ({ id }) =>
      !listed.some((row) => row.id === id) &&
      !holders.some((row) => row.id === id),
  );
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
  savedRemovesOpener = false,
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
  // Where focus goes when the opener is gone (see useSavedFocus).
  returnFocusTo: () => HTMLElement | null;
  savedRemovesOpener?: boolean;
  onClose: () => void;
  onSubmit: (fields: SourceConnectionFields) => Promise<WriteResult>;
  onSaved: (label: string) => void;
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
  const [listed, setListed] = useState(holders);
  const [addingHolder, setAddingHolder] = useState(false);
  // Each opening of the new holder's field gets a key; a save that lands
  // after its field was closed only adds the holder, without choosing it.
  const [holderFieldKey, setHolderFieldKey] = useState(0);
  const openHolderField = useRef<number | null>(null);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const [holderPending, setHolderPending] = useState(false);
  const institution = useRef<HTMLInputElement>(null);
  const holderTrigger = useRef<HTMLButtonElement>(null);
  const portfolioTrigger = useRef<HTMLButtonElement>(null);
  const focus = useSavedFocus(returnFocusTo, savedRemovesOpener);

  if (listed !== holders) {
    setListed(holders);
    setAdded((rows) => pruneAdded(listed, holders, rows));
  }

  function showHolderField() {
    const key = holderFieldKey + 1;
    setHolderFieldKey(key);
    openHolderField.current = key;
    setAddingHolder(true);
  }

  function closeHolderField() {
    openHolderField.current = null;
    setAddingHolder(false);
    holderTrigger.current?.focus();
  }

  function holderCreated(row: HolderRow, key: number) {
    setAdded((rows) => [...rows, row]);
    if (openHolderField.current !== key) return;
    setHolder(row.id);
    closeHolderField();
  }

  const holderOptions = holderChoices(holders, added);
  // A choice the page no longer offers, archived from another tab, is
  // unchosen.
  const chosenHolder =
    holder === SELF_HOLDER || holderOptions.some(({ id }) => id === holder)
      ? holder
      : "";
  const chosenPortfolio = portfolios.some(({ id }) => id === portfolio)
    ? portfolio
    : "";

  // A new holder still saving holds the account back too: its save may be
  // the holder the account is about to pick.
  function submit() {
    if (pending || holderPending) return;
    const fields = {
      institution: institution.current?.value ?? "",
      holder: chosenHolder,
      includeInTaxReport,
      defaultPortfolioId: chosenPortfolio,
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
        focus.markSaved();
        const holderName =
          holderOptions.find(({ id }) => id === fields.holder)?.name ?? null;
        onSaved(accountLabel(normalizeName(fields.institution), holderName));
        onClose();
      } else {
        setError(answer.text);
      }
    });
  }

  return (
    <AppDialog
      onClose={onClose}
      pending={pending || holderPending}
      title={title}
      description={description}
      returnFocusTo={focus.returnFocusTo}
      onEscapeKeyDown={(event) => {
        // While the new holder's field is open, Escape closes it instead of
        // the dialog.
        if (!addingHolder) return;
        event.preventDefault();
        closeHolderField();
      }}
    >
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="grid gap-4">
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
              <Select value={chosenHolder} onValueChange={choose(setHolder)}>
                <SelectTrigger
                  ref={holderTrigger}
                  id={ids.holder}
                  className="min-w-0 flex-1"
                  aria-invalid={error && !chosenHolder ? true : undefined}
                >
                  <SelectValue placeholder="Elegí un titular" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SELF_HOLDER}>
                    {SELF_HOLDER_LABEL}
                  </SelectItem>
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
                  size="sm"
                  className="h-9"
                  onClick={showHolderField}
                >
                  <Plus />
                  Nuevo titular
                </Button>
              )}
            </div>
            {addingHolder && (
              <NewHolderField
                key={holderFieldKey}
                onCreated={(row) => holderCreated(row, holderFieldKey)}
                onCancel={closeHolderField}
                onPendingChange={setHolderPending}
              />
            )}
          </div>

          <div className="grid gap-2">
            <Label htmlFor={ids.portfolio}>Cartera por defecto</Label>
            <Select
              value={chosenPortfolio}
              onValueChange={choose(setPortfolio)}
            >
              <SelectTrigger
                ref={portfolioTrigger}
                id={ids.portfolio}
                className="w-full"
                aria-invalid={error && !chosenPortfolio ? true : undefined}
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
          <PendingButton
            type="submit"
            size="sm"
            pending={pending}
            aria-describedby={error ? ids.alert : undefined}
          >
            {pending ? "Guardando…" : submitLabel}
          </PendingButton>
        </DialogFooter>
      </form>
    </AppDialog>
  );
}
