"use client";

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
import {
  CHOICE_MESSAGES,
  WRITE_MESSAGES,
} from "@/lib/portfolio-setup/messages";
import { normalizeName } from "@/lib/portfolio-setup/normalize-name";
import type {
  PortfolioRow,
  SourceConnectionRow,
} from "@/lib/portfolio-setup/read";
import {
  InstitutionField,
  chosenInstitution,
  institutionChoice,
  typedInstitution,
} from "./institution-field";
import { useFieldAlert } from "./field-alert";
import { useSavedFocus } from "./saved-focus";
import { ReportSwitch } from "./report-switch";

export type SourceConnectionFields = {
  institution: string;
  includeInTaxReport: boolean;
  defaultPortfolioId: string;
};

// The dialog's starting values. An archived portfolio is not among the page's
// choices, so it starts unchosen (offeredPortfolio) and a restore makes the
// user choose an active one.
export function initialFields(
  row: SourceConnectionRow | null,
  portfolios: PortfolioRow[],
): SourceConnectionFields {
  if (!row) {
    return {
      institution: "",
      includeInTaxReport: true,
      // The oldest active portfolio listed, the first one the user had unless
      // they archived it.
      defaultPortfolioId: portfolios.at(-1)?.id ?? "",
    };
  }
  return {
    institution: row.institution,
    includeInTaxReport: row.includeInTaxReport,
    defaultPortfolioId: row.portfolio.id,
  };
}

type AccountField = "institution" | "portfolio";

const MESSAGES = WRITE_MESSAGES.source_connections;

// The field a refused write's alert is about; none for an alert about the
// write itself, such as a failed save.
function refusedField(text: string): AccountField | null {
  if (text === MESSAGES.invalid) return "institution";
  if (text === MESSAGES.portfolio_archived) return "portfolio";
  return null;
}

// The row the fields describe, as the page shows it until the server's
// refresh: inverse to initialFields.
export function accountRow(
  id: string,
  fields: SourceConnectionFields,
  portfolio: PortfolioRow,
): SourceConnectionRow {
  return {
    id,
    institution: normalizeName(fields.institution),
    includeInTaxReport: fields.includeInTaxReport,
    portfolio: { ...portfolio, archived: false },
  };
}

// The portfolio the dialog can submit: one the page no longer offers, archived
// from another tab, is unchosen.
export function offeredPortfolio(
  portfolios: PortfolioRow[],
  id: string,
): PortfolioRow | undefined {
  return portfolios.find((row) => row.id === id);
}

// Creates, edits or restores an account, handing its fields to `onSubmit` as
// it closes; a refused write opens it again with the fields and the alert.
export function SourceConnectionDialog({
  title,
  description,
  submitLabel,
  initial,
  initialError,
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
  portfolios: PortfolioRow[];
  // Where focus goes when the opener is gone (see useSavedFocus).
  returnFocusTo: () => HTMLElement | null;
  savedRemovesOpener?: boolean;
  onClose: () => void;
  // False when the write could not start; the dialog stays open.
  onSubmit: (
    fields: SourceConnectionFields,
    portfolio: PortfolioRow,
  ) => boolean;
}) {
  const ids = {
    institution: useId(),
    portfolio: useId(),
    tax: useId(),
    alert: useId(),
  };
  const [institutionPick, setInstitutionPick] = useState(() =>
    institutionChoice(initial.institution),
  );
  const [portfolio, setPortfolio] = useState(initial.defaultPortfolioId);
  const [includeInTaxReport, setIncludeInTaxReport] = useState(
    initial.includeInTaxReport,
  );
  const { alert, setAlert, firstField, invalid, settle, pick } =
    useFieldAlert<AccountField>(initialError, refusedField, "institution");
  const institutionTrigger = useRef<HTMLButtonElement>(null);
  const otherInstitution = useRef<HTMLInputElement>(null);
  const portfolioTrigger = useRef<HTMLButtonElement>(null);
  const focus = useSavedFocus(returnFocusTo, savedRemovesOpener);

  const offered = offeredPortfolio(portfolios, portfolio);

  function submit() {
    const institution = chosenInstitution(
      institutionPick,
      otherInstitution.current?.value ?? "",
    );
    if (institutionPick === "") {
      setAlert({ text: CHOICE_MESSAGES.institution, field: "institution" });
      institutionTrigger.current?.focus();
      return;
    }
    if (normalizeName(institution) === "") {
      setAlert({ text: MESSAGES.invalid, field: "institution" });
      otherInstitution.current?.focus();
      return;
    }
    if (!offered) {
      setAlert({ text: CHOICE_MESSAGES.portfolio, field: "portfolio" });
      portfolioTrigger.current?.focus();
      return;
    }
    setAlert(undefined);
    const fields = {
      institution,
      includeInTaxReport,
      defaultPortfolioId: offered.id,
    };
    if (!onSubmit(fields, offered)) return;
    focus.markSaved();
    onClose();
  }

  return (
    <AppDialog
      onClose={onClose}
      title={title}
      description={description}
      returnFocusTo={focus.returnFocusTo}
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
            <Label htmlFor={ids.portfolio}>Cartera por defecto</Label>
            <Select
              value={offered?.id ?? ""}
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

          <ReportSwitch
            id={ids.tax}
            checked={includeInTaxReport}
            onCheckedChange={setIncludeInTaxReport}
          />

          {alert && <FormAlert id={ids.alert}>{alert.text}</FormAlert>}
        </div>
        <DialogFooter>
          <Button
            type="submit"
            size="sm"
            aria-describedby={alert ? ids.alert : undefined}
          >
            {submitLabel}
          </Button>
        </DialogFooter>
      </form>
    </AppDialog>
  );
}
