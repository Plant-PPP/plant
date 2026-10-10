"use client";

import { Plus } from "lucide-react";
import { useId, useRef, useState } from "react";
import { AppDialog } from "@/components/ui/app-dialog";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { FormAlert } from "@/components/ui/form-alert";
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
import {
  InstitutionField,
  chosenInstitution,
  institutionChoice,
  typedInstitution,
} from "./institution-field";
import { NewHolderField } from "./new-holder-field";
import { useSavedFocus } from "./saved-focus";
import { PendingButton } from "@/components/ui/pending-button";

export type SourceConnectionFields = {
  institution: string;
  holder: string;
  includeInTaxReport: boolean;
  defaultPortfolioId: string;
};

// The dialog's starting values. An archived holder or portfolio is not among
// the page's choices, so it starts unchosen (offeredChoices) and a restore
// makes the user choose an active one.
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
    holder: row.holder?.id ?? SELF_HOLDER,
    includeInTaxReport: row.includeInTaxReport,
    defaultPortfolioId: row.portfolio.id,
  };
}

type AccountField = "institution" | "holder" | "portfolio";

const MESSAGES = WRITE_MESSAGES.source_connections;

// The field a refused write's alert is about; none for an alert about the
// write itself, such as a failed save.
function refusedField(text: string): AccountField | null {
  if (text === MESSAGES.invalid) return "institution";
  if (text === MESSAGES.holder_archived) return "holder";
  if (text === MESSAGES.portfolio_archived) return "portfolio";
  return null;
}

// The holder and portfolio an account's fields chose, as the page lists them.
export type ChosenRows = { holder: HolderRow | null; portfolio: PortfolioRow };

// The row the fields describe, as the page shows it until the server's
// refresh: inverse to initialFields.
export function accountRow(
  id: string,
  fields: SourceConnectionFields,
  { holder, portfolio }: ChosenRows,
): SourceConnectionRow {
  return {
    id,
    institution: normalizeName(fields.institution),
    includeInTaxReport: fields.includeInTaxReport,
    holder: holder && { ...holder, archived: false },
    portfolio: { ...portfolio, archived: false },
  };
}

// The holder or portfolio select the user left unchosen, or that
// offeredChoices unchose because the page no longer lists the account's holder
// or portfolio.
export function missingChoice(
  fields: Pick<SourceConnectionFields, "holder" | "defaultPortfolioId">,
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

// The holder and portfolio the dialog can submit: a choice the page no longer
// offers, archived from another tab, is unchosen.
function offeredChoices(
  holder: string,
  portfolio: string,
  holderOptions: HolderRow[],
  portfolios: PortfolioRow[],
) {
  return {
    holder:
      holder === SELF_HOLDER || holderOptions.some(({ id }) => id === holder)
        ? holder
        : "",
    defaultPortfolioId: portfolios.some(({ id }) => id === portfolio)
      ? portfolio
      : "",
  };
}

// Creates, edits or restores an account, handing its fields to `onSubmit` as
// it closes; a refused write opens it again with the fields and the alert. A
// new holder can be added from the dialog without leaving it: its field has no
// form of its own, so Enter there saves the holder and never the account.
export function SourceConnectionDialog({
  title,
  description,
  submitLabel,
  initial,
  initialError,
  holders,
  portfolios,
  returnFocusTo,
  savedRemovesOpener = false,
  onClose,
  onSubmit,
}: {
  title: string;
  description: string;
  submitLabel: string;
  initial: SourceConnectionFields;
  initialError?: string;
  holders: HolderRow[];
  portfolios: PortfolioRow[];
  // Where focus goes when the opener is gone (see useSavedFocus).
  returnFocusTo: () => HTMLElement | null;
  savedRemovesOpener?: boolean;
  onClose: () => void;
  // False when the write could not start; the dialog stays open.
  onSubmit: (fields: SourceConnectionFields, chosen: ChosenRows) => boolean;
}) {
  const ids = {
    institution: useId(),
    holder: useId(),
    portfolio: useId(),
    tax: useId(),
    alert: useId(),
  };
  const [institutionPick, setInstitutionPick] = useState(() =>
    institutionChoice(initial.institution),
  );
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
  const [alert, setAlert] = useState<
    { text: string; field: AccountField | null } | undefined
  >(() =>
    initialError
      ? { text: initialError, field: refusedField(initialError) }
      : undefined,
  );
  // A reopened dialog starts on the field its alert is about.
  const [firstField] = useState(() => alert?.field ?? "institution");
  // A new holder still saving holds the dialog and its submit: the holder it
  // saves may be the one the account picks.
  const [holderPending, setHolderPending] = useState(false);
  const institutionTrigger = useRef<HTMLButtonElement>(null);
  const otherInstitution = useRef<HTMLInputElement>(null);
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
    settle("holder");
    closeHolderField();
  }

  const holderOptions = holderChoices(holders, added);
  const { holder: chosenHolder, defaultPortfolioId: chosenPortfolio } =
    offeredChoices(holder, portfolio, holderOptions, portfolios);
  const invalid = (field: AccountField) =>
    alert?.field === field ? true : undefined;
  function settle(field: AccountField) {
    if (alert?.field === field) setAlert(undefined);
  }
  const pick = (field: AccountField, set: (value: string) => void) =>
    choose((value) => {
      set(value);
      settle(field);
    });

  function submit() {
    if (holderPending) return;
    const fields = {
      institution: chosenInstitution(
        institutionPick,
        otherInstitution.current?.value ?? "",
      ),
      holder: chosenHolder,
      includeInTaxReport,
      defaultPortfolioId: chosenPortfolio,
    };
    if (institutionPick === "") {
      setAlert({ text: CHOICE_MESSAGES.institution, field: "institution" });
      institutionTrigger.current?.focus();
      return;
    }
    if (normalizeName(fields.institution) === "") {
      setAlert({ text: MESSAGES.invalid, field: "institution" });
      otherInstitution.current?.focus();
      return;
    }
    const missing = missingChoice(fields);
    if (missing) {
      setAlert({ text: CHOICE_MESSAGES[missing], field: missing });
      (missing === "holder"
        ? holderTrigger
        : portfolioTrigger
      ).current?.focus();
      return;
    }
    // offeredChoices keeps only a listed portfolio; the user's own holder has
    // no row.
    const holderRow =
      holderOptions.find(({ id }) => id === fields.holder) ?? null;
    const portfolioRow = portfolios.find(
      ({ id }) => id === fields.defaultPortfolioId,
    );
    if (!portfolioRow) return;
    setAlert(undefined);
    if (!onSubmit(fields, { holder: holderRow, portfolio: portfolioRow })) {
      return;
    }
    focus.markSaved();
    onClose();
  }

  return (
    <AppDialog
      onClose={onClose}
      pending={holderPending}
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
            <InstitutionField
              id={ids.institution}
              choice={institutionPick}
              onChoose={pick("institution", setInstitutionPick)}
              initialOther={typedInstitution(initial.institution)}
              triggerRef={institutionTrigger}
              otherRef={otherInstitution}
              onOtherChange={() => settle("institution")}
              invalid={invalid("institution")}
              describedBy={invalid("institution") ? ids.alert : undefined}
              autoFocus={firstField === "institution"}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor={ids.holder}>Titular</Label>
            <div className="flex gap-2">
              <Select
                value={chosenHolder}
                onValueChange={pick("holder", setHolder)}
              >
                <SelectTrigger
                  ref={holderTrigger}
                  id={ids.holder}
                  className="min-w-0 flex-1"
                  aria-invalid={invalid("holder")}
                  aria-describedby={invalid("holder") && ids.alert}
                  autoFocus={firstField === "holder"}
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
              onValueChange={pick("portfolio", setPortfolio)}
            >
              <SelectTrigger
                ref={portfolioTrigger}
                id={ids.portfolio}
                className="w-full"
                aria-invalid={invalid("portfolio")}
                aria-describedby={invalid("portfolio") && ids.alert}
                autoFocus={firstField === "portfolio"}
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

          {alert && <FormAlert id={ids.alert}>{alert.text}</FormAlert>}
        </div>
        <DialogFooter>
          <PendingButton
            type="submit"
            size="sm"
            pending={holderPending}
            aria-describedby={alert ? ids.alert : undefined}
          >
            {submitLabel}
          </PendingButton>
        </DialogFooter>
      </form>
    </AppDialog>
  );
}
