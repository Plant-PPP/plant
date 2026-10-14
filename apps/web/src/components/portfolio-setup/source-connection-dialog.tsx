"use client";

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
import type { IconResult } from "@/lib/institutions/read-icon";
import {
  CHOICE_MESSAGES,
  WRITE_MESSAGES,
} from "@/lib/portfolio-setup/messages";
import { normalizeName } from "@/lib/portfolio-setup/normalize-name";
import { settle as settleCall } from "@/lib/server-action-call";
import type {
  PortfolioRow,
  SourceConnectionRow,
} from "@/lib/portfolio-setup/read";
import {
  InstitutionField,
  OTHER_INSTITUTION,
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
  // The site of an institution the app ships no icon of, and the icon Plant's
  // server read from it; null when there is none.
  website: string | null;
  icon: string | null;
};

// Why a site gave no icon, as the user reads it.
const ICON_MESSAGES: Record<
  Extract<IconResult, { ok: false }>["reason"],
  string
> = {
  url: "Escribí el sitio con https://, por ejemplo https://www.banco.com.ar.",
  private:
    "Ese sitio no es público. Usá la dirección que abrís en el navegador.",
  unreachable:
    "No pudimos abrir ese sitio. Revisá la dirección o dejalo vacío.",
  not_image:
    "Ese sitio no tiene un ícono que podamos mostrar. Dejalo vacío para usar la inicial.",
  too_large:
    "El ícono de ese sitio es muy grande. Dejalo vacío para usar la inicial.",
  failed: "No pudimos leer el ícono. Probá de nuevo o dejalo vacío.",
  limited:
    "Probaste muchos sitios seguidos. Esperá un minuto y volvé a intentar.",
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
      website: null,
      icon: null,
    };
  }
  return {
    institution: row.institution,
    includeInTaxReport: row.includeInTaxReport,
    defaultPortfolioId: row.portfolio.id,
    website: row.website ?? null,
    icon: row.icon ?? null,
  };
}

type AccountField = "institution" | "website" | "portfolio";

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
    ...(fields.website !== null && { website: fields.website }),
    ...(fields.icon !== null && { icon: fields.icon }),
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

// The icon a site gives, a call that failed as a failed read.
export async function readSiteIcon(
  readIcon: (site: string) => Promise<IconResult>,
  site: string,
): Promise<IconResult> {
  const read = await settleCall(readIcon(site));
  return read === "rejected" ? { ok: false, reason: "failed" } : read;
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
  readIcon,
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
  // Reads the icon of the site typed for an institution the app ships no
  // icon of; without it the dialog asks for no site.
  readIcon?: (site: string) => Promise<IconResult>;
}) {
  const ids = {
    institution: useId(),
    portfolio: useId(),
    website: useId(),
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
  const website = useRef<HTMLInputElement>(null);
  const [reading, startReading] = useTransition();
  // Closed while the icon was read: the read saves nothing.
  const closed = useRef(false);
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
      website: null,
      icon: null,
    };
    const site = website.current?.value.trim() ?? "";
    if (institutionPick !== OTHER_INSTITUTION || !readIcon || site === "") {
      save(fields, offered);
      return;
    }
    // The same site keeps the icon read before.
    if (site === initial.website && initial.icon !== null) {
      save(
        { ...fields, website: initial.website, icon: initial.icon },
        offered,
      );
      return;
    }
    startReading(async () => {
      const read = await readSiteIcon(readIcon, site);
      if (closed.current) return;
      if (!read.ok) {
        setAlert({ text: ICON_MESSAGES[read.reason], field: "website" });
        website.current?.focus();
        return;
      }
      save({ ...fields, website: read.website, icon: read.icon }, offered);
    });
  }

  function save(fields: SourceConnectionFields, portfolio: PortfolioRow) {
    if (!onSubmit(fields, portfolio)) return;
    focus.markSaved();
    onClose();
  }

  return (
    <AppDialog
      onClose={() => {
        closed.current = true;
        onClose();
      }}
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

          {readIcon && (
            <div
              className="grid gap-2"
              hidden={institutionPick !== OTHER_INSTITUTION}
            >
              <Label htmlFor={ids.website}>Sitio web · Opcional</Label>
              <Input
                ref={website}
                id={ids.website}
                inputMode="url"
                placeholder="https://www.banco.com.ar"
                defaultValue={initial.website ?? ""}
                maxLength={200}
                onChange={() => settle("website")}
                aria-invalid={invalid("website")}
                aria-describedby={invalid("website") ? ids.alert : undefined}
                autoComplete="off"
                autoFocus={firstField === "website"}
              />
              <p className="text-xs text-muted-foreground">
                Lo usamos para mostrar su ícono. Lo baja Plant, sin avisarle a
                nadie.
              </p>
            </div>
          )}

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
            disabled={reading}
            aria-describedby={alert ? ids.alert : undefined}
          >
            {submitLabel}
          </Button>
        </DialogFooter>
      </form>
    </AppDialog>
  );
}
