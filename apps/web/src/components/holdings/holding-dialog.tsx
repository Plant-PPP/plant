"use client";

import { Wallet } from "lucide-react";
import { DialogActions } from "@/components/ui/dialog-actions";
import type { Currency } from "@plant/shared";
import Link from "next/link";

import type { PlacementKind } from "@/lib/holdings/placement";
import type * as React from "react";
import { useId, useState } from "react";

import { AppDialog } from "@/components/ui/app-dialog";
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
import {
  type FieldAlert,
  choose,
  useFieldAlert,
} from "@/components/portfolio-setup/field-alert";
import {
  ExcludedAccountsNote,
  ReportSwitch,
} from "@/components/portfolio-setup/report-switch";
import { useSavedFocus } from "@/components/portfolio-setup/saved-focus";
import { useCatalog } from "@/components/holdings/instrument-market";
import {
  type HoldingOrigin,
  holdingName,
  holdingPlace,
  instrumentNames,
  originText,
} from "@/lib/holdings/holding-name";
import { classOf, HOLDING_CLASS_LABELS } from "@/lib/holdings/classes";
import { ASSET_CLASSES, ASSET_CLASS_LABELS } from "@/lib/holdings/messages";
import type { HoldingRow, InstrumentRow } from "@/lib/holdings/read";
import {
  holdingInsertSchema,
  holdingUpdateSchema,
} from "@/lib/holdings/schemas";
import { accountInTaxReport } from "@/lib/holdings/tax-report";
import type {
  PortfolioRow,
  SourceConnectionRow,
} from "@/lib/portfolio-setup/read";

import {
  type DialogField,
  FIELD_MESSAGES,
  FIELDS_BY_CLASS,
  type HoldingFields,
  refusal,
  refusalLink,
  refusedField,
  toInsert,
  toUpdate,
} from "./holding-fields";
import { type AssetClass, CURRENCY_LABELS } from "@/lib/holdings/messages";

import { ImportOrigin } from "./holding-cells";
import { InstrumentPicker } from "./instrument-picker";
import { PlacementFigures, PlacementKindSelect } from "./placement-fields";

// What the amount is, by class.
const AMOUNT_LABELS: Record<AssetClass, string> = {
  instrument: "Cantidad",
  cash: "Monto",
  fixed_term: "Monto",
  real_estate: "Valor",
  other: "Valor",
};

export type ChosenHolding = Pick<
  HoldingRow,
  "account" | "portfolio" | "instrumentType"
>;

const accountOf = (row: SourceConnectionRow): HoldingRow["account"] => ({
  id: row.id,
  institution: row.institution,
});

// Creates or edits a holding, handing its fields to `onSubmit` as it closes;
// a refused write opens it again with the fields and the alert. An edit keeps
// the class, the account and the instrument; it can move the holding to
// another portfolio. With `details`, an edit shows where the holding came from
// and whether its asset counts in the report.
export function HoldingDialog({
  mode,
  row,
  details,
  placement,
  accounts,
  portfolios,
  instruments: givenInstruments,
  initial,
  initialError,
  portfolioChosen = false,
  returnFocusTo,
  onClose,
  onSubmit,
}: {
  mode: "create" | "edit";
  row?: HoldingRow;
  // The holding's origin and its asset's report choice as saved.
  details?: { origin: HoldingOrigin | undefined; inTaxReport: boolean };
  // On a page that knows what a placement at a rate is: its kind as saved
  // (a plazo fijo for a new one), today for its figures, and the placement
  // it renewed.
  placement?: {
    kind: PlacementKind;
    today: string;
    renewed?: HoldingRow;
  };
  accounts: SourceConnectionRow[];
  portfolios: PortfolioRow[];
  instruments: InstrumentRow[];
  initial: HoldingFields;
  initialError?: string;
  // The portfolio stays as given when the account changes.
  portfolioChosen?: boolean;
  returnFocusTo: () => HTMLElement | null;
  onClose: () => void;
  // False when the write could not start; the dialog stays open.
  onSubmit: (fields: HoldingFields, chosen: ChosenHolding) => boolean;
}) {
  const [instruments, addToCatalog] = useCatalog(givenInstruments);
  const id = useId();
  const fieldId = (field: DialogField | "assetClass") => `${id}-${field}`;
  const alertId = `${id}-alert`;
  const taxId = `${id}-tax`;
  const accountIncluded = !row || accountInTaxReport(accounts, row.account.id);
  const [fields, setFields] = useState(initial);
  // The portfolio follows the account's until the user picks one.
  const [portfolioPicked, setPortfolioPicked] = useState(
    mode === "edit" || portfolioChosen,
  );
  const { alert, setAlert, firstField, invalid, settle, pick } =
    useFieldAlert<DialogField>(
      initialError,
      (text) => refusedField(mode, text),
      mode === "create" ? "account" : "amount",
    );
  const link = alert && refusalLink(alert.text);
  const focus = useSavedFocus(returnFocusTo, false);
  const shown = new Set<string>(FIELDS_BY_CLASS[fields.assetClass]);

  const set =
    <K extends keyof HoldingFields>(key: K) =>
    (value: HoldingFields[K]) =>
      setFields((current) => ({ ...current, [key]: value }));

  function chooseAccount(accountId: string) {
    setFields((current) => {
      const account = accounts.find((each) => each.id === accountId);
      const followed =
        !portfolioPicked &&
        account &&
        portfolios.some((p) => p.id === account.portfolio.id);
      return {
        ...current,
        accountId,
        ...(followed && { portfolioId: account.portfolio.id }),
      };
    });
  }

  // Common props of a control that can be refused.
  const control = (field: DialogField) => ({
    id: fieldId(field),
    "aria-invalid": invalid(field),
    "aria-describedby": invalid(field) && alertId,
    autoFocus: firstField === field,
  });
  function submit() {
    const account = accounts.find(({ id }) => id === fields.accountId);
    const portfolio = portfolios.find(({ id }) => id === fields.portfolioId);
    const parsed =
      mode === "create"
        ? holdingInsertSchema.safeParse(toInsert(fields))
        : holdingUpdateSchema.safeParse(
            toUpdate(fields, row?.portfolio.id ?? fields.portfolioId),
          );
    // The page's lists may have lost a choice archived from another tab.
    const chosenAccount =
      mode === "edit" ? row?.account : account && accountOf(account);
    if (!parsed.success || !chosenAccount || !portfolio) {
      const refused: FieldAlert<DialogField> = !parsed.success
        ? refusal(parsed.error)
        : !chosenAccount
          ? { field: "account", text: FIELD_MESSAGES.account }
          : { field: "portfolio", text: FIELD_MESSAGES.portfolio };
      setAlert(refused);
      if (refused.field)
        document.getElementById(fieldId(refused.field))?.focus();
      return;
    }
    setAlert(undefined);
    const chosen: ChosenHolding = {
      account: chosenAccount,
      portfolio: { id: portfolio.id, name: portfolio.name },
      instrumentType:
        fields.assetClass === "instrument"
          ? (instruments.find(({ symbol }) => symbol === fields.instrument)
              ?.type ??
            row?.instrumentType ??
            null)
          : null,
    };
    if (!onSubmit(fields, chosen)) return;
    focus.markSaved();
    onClose();
  }

  const textField = (
    field: DialogField,
    key: Exclude<keyof HoldingFields, "inTaxReport">,
    label: string,
    props: React.ComponentProps<typeof Input> = {},
  ) => (
    <div className="grid gap-2">
      <Label htmlFor={fieldId(field)}>{label}</Label>
      <Input
        {...control(field)}
        value={fields[key]}
        onChange={(event) => {
          set(key)(event.target.value as never);
          settle(field);
        }}
        {...props}
      />
    </div>
  );

  return (
    <AppDialog
      onClose={onClose}
      title={mode === "create" ? "Agregar tenencia" : "Editar tenencia"}
      icon={Wallet}
      description={
        mode === "create"
          ? "Contanos qué tenés y en qué cuenta."
          : "Cambiá los datos de la tenencia."
      }
      returnFocusTo={focus.returnFocusTo}
    >
      <form
        className="grid gap-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="grid gap-4">
          {mode === "create" ? (
            <>
              <div className="grid gap-2">
                <Label htmlFor={fieldId("assetClass")}>Tipo</Label>
                <Select
                  value={fields.assetClass}
                  onValueChange={choose((value) => {
                    set("assetClass")(value as AssetClass);
                    setAlert(undefined);
                  })}
                >
                  <SelectTrigger id={fieldId("assetClass")} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ASSET_CLASSES.map((each) => (
                      <SelectItem key={each} value={each}>
                        {ASSET_CLASS_LABELS[each]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor={fieldId("account")}>Cuenta</Label>
                <Select
                  value={fields.accountId}
                  onValueChange={pick("account", chooseAccount)}
                >
                  <SelectTrigger {...control("account")} className="w-full">
                    <SelectValue placeholder="Elegí una cuenta" />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((each) => (
                      <SelectItem key={each.id} value={each.id}>
                        {holdingPlace({
                          account: each,
                          portfolio: each.portfolio,
                        })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          ) : (
            row && (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted-foreground">Tipo</dt>
                <dd>{HOLDING_CLASS_LABELS[classOf(row)]}</dd>
                <dt className="text-muted-foreground">Cuenta</dt>
                <dd>{row.account.institution}</dd>
                {row.holding.asset_class === "instrument" && (
                  <>
                    <dt className="text-muted-foreground">Instrumento</dt>
                    <dd>
                      {holdingName(row.holding, instrumentNames(instruments))}
                    </dd>
                  </>
                )}
                {details?.origin && (
                  <>
                    <dt className="text-muted-foreground">Origen</dt>
                    <dd>
                      {details.origin.kind === "import" ? (
                        <ImportOrigin origin={details.origin} />
                      ) : (
                        originText(details.origin)
                      )}
                    </dd>
                  </>
                )}
              </dl>
            )
          )}

          <div className="grid gap-2">
            <Label htmlFor={fieldId("portfolio")}>Cartera</Label>
            <Select
              value={fields.portfolioId}
              onValueChange={pick("portfolio", (value) => {
                setPortfolioPicked(true);
                set("portfolioId")(value);
              })}
            >
              <SelectTrigger {...control("portfolio")} className="w-full">
                <SelectValue placeholder="Elegí una cartera" />
              </SelectTrigger>
              <SelectContent>
                {portfolios.map((each) => (
                  <SelectItem key={each.id} value={each.id}>
                    {each.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {mode === "create" && shown.has("instrument_symbol") && (
            <div className="grid gap-2">
              <Label
                id={`${fieldId("instrument")}-label`}
                htmlFor={fieldId("instrument")}
              >
                Instrumento
              </Label>
              <InstrumentPicker
                {...control("instrument")}
                labelId={`${fieldId("instrument")}-label`}
                instruments={instruments}
                value={fields.instrument}
                onChange={pick("instrument", set("instrument"))}
                onAdded={addToCatalog}
                placeholder="Elegí un instrumento"
              />
            </div>
          )}

          {shown.has("currency") && (
            <div className="grid gap-2">
              <Label htmlFor={fieldId("currency")}>Moneda</Label>
              <Select
                value={fields.currency}
                onValueChange={pick("currency", (value) =>
                  set("currency")(value as Currency),
                )}
              >
                <SelectTrigger {...control("currency")} className="w-full">
                  <SelectValue placeholder="Elegí una moneda" />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(CURRENCY_LABELS) as Currency[]).map((each) => (
                    <SelectItem key={each} value={each}>
                      {CURRENCY_LABELS[each]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {textField("amount", "amount", AMOUNT_LABELS[fields.assetClass], {
            required: true,
            inputMode: "decimal",
            autoComplete: "off",
          })}
          {shown.has("annual_rate") &&
            textField("rate", "rate", "TNA (%)", {
              inputMode: "decimal",
              autoComplete: "off",
            })}
          {shown.has("started_on") &&
            textField("startedOn", "startedOn", "Desde", { type: "date" })}
          {shown.has("matures_on") &&
            textField("maturesOn", "maturesOn", "Vence", { type: "date" })}
          {fields.assetClass === "fixed_term" && placement && (
            <PlacementKindSelect
              id={`${id}-placement`}
              value={fields.placement ?? placement.kind}
              onChange={set("placement")}
            />
          )}
          {mode === "edit" &&
            placement &&
            row?.holding.asset_class === "fixed_term" && (
              <PlacementFigures
                placement={row.holding}
                today={placement.today}
                renewed={
                  placement.renewed?.holding.asset_class === "fixed_term"
                    ? placement.renewed.holding
                    : undefined
                }
              />
            )}
          {shown.has("valued_on") &&
            textField("valuedOn", "valuedOn", "Valuado el", { type: "date" })}
          {shown.has("label") &&
            textField("label", "label", "Nombre", { autoComplete: "off" })}

          {mode === "edit" && details && row && (
            <ReportSwitch
              id={taxId}
              checked={fields.inTaxReport ?? details.inTaxReport}
              onCheckedChange={set("inTaxReport")}
              note={
                !accountIncluded && (
                  <ExcludedAccountsNote
                    institutions={[row.account.institution]}
                    subject="holding"
                  />
                )
              }
            />
          )}

          {alert && (
            <FormAlert id={alertId}>
              {alert.text}
              {link && (
                <>
                  {" "}
                  <Link href={link.href}>{link.label}</Link>
                </>
              )}
            </FormAlert>
          )}
        </div>
        <DialogActions
          submitLabel={mode === "create" ? "Agregar" : "Guardar"}
          describedBy={alert ? alertId : undefined}
        />
      </form>
    </AppDialog>
  );
}
