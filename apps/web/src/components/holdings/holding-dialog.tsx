"use client";

import type { Currency } from "@plant/shared";
import type * as React from "react";
import { useId, useState } from "react";

import { AppDialog } from "@/components/ui/app-dialog";
import { DialogFooter } from "@/components/ui/dialog";
import { FormAlert } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
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
import { useSavedFocus } from "@/components/portfolio-setup/saved-focus";
import { holdingName, instrumentNames } from "@/lib/holdings/holding-name";
import { ASSET_CLASSES, ASSET_CLASS_LABELS } from "@/lib/holdings/messages";
import type { HoldingRow, InstrumentRow } from "@/lib/holdings/read";
import {
  holdingInsertSchema,
  holdingUpdateSchema,
} from "@/lib/holdings/schemas";
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
  refusedField,
  toInsert,
  toUpdate,
} from "./holding-fields";
import type { AssetClass } from "@/lib/holdings/messages";

const CURRENCY_LABELS: Record<Currency, string> = {
  ARS: "Pesos (ARS)",
  USD: "Dólares (USD)",
};

// What the amount is, by class.
const AMOUNT_LABELS: Record<AssetClass, string> = {
  instrument: "Cantidad",
  cash: "Monto",
  fixed_term: "Monto",
  real_estate: "Valor",
  other: "Valor",
};

export type ChosenHolding = Pick<HoldingRow, "account" | "portfolio">;

const accountOf = (row: SourceConnectionRow): HoldingRow["account"] => ({
  id: row.id,
  institution: row.institution,
});

// Creates or edits a holding, handing its fields to `onSubmit` as it closes;
// a refused write opens it again with the fields and the alert. An edit keeps
// the class, the account and the instrument; it can move the holding to
// another portfolio.
export function HoldingDialog({
  mode,
  row,
  accounts,
  portfolios,
  instruments,
  initial,
  initialError,
  portfolioChosen = false,
  returnFocusTo,
  onClose,
  onSubmit,
}: {
  mode: "create" | "edit";
  row?: HoldingRow;
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
  const id = useId();
  const fieldId = (field: DialogField | "assetClass") => `${id}-${field}`;
  const alertId = `${id}-alert`;
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
    };
    if (!onSubmit(fields, chosen)) return;
    focus.markSaved();
    onClose();
  }

  const textField = (
    field: DialogField,
    key: keyof HoldingFields,
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
                        {`${each.institution} · ${each.portfolio.name}`}
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
                <dd>{ASSET_CLASS_LABELS[row.holding.asset_class]}</dd>
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
              <Label htmlFor={fieldId("instrument")}>Instrumento</Label>
              <Select
                value={fields.instrument}
                onValueChange={pick("instrument", set("instrument"))}
              >
                <SelectTrigger {...control("instrument")} className="w-full">
                  <SelectValue placeholder="Elegí un instrumento" />
                </SelectTrigger>
                <SelectContent>
                  {instruments.map((each) => (
                    <SelectItem key={each.symbol} value={each.symbol}>
                      {`${each.symbol} · ${each.name}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
          {shown.has("valued_on") &&
            textField("valuedOn", "valuedOn", "Valuado el", { type: "date" })}
          {shown.has("label") &&
            textField(
              "label",
              "label",
              fields.assetClass === "cash" || fields.assetClass === "fixed_term"
                ? "Nombre (opcional)"
                : "Nombre",
              { autoComplete: "off" },
            )}

          {alert && <FormAlert id={alertId}>{alert.text}</FormAlert>}
        </div>
        <DialogFooter>
          <Button
            type="submit"
            size="sm"
            aria-describedby={alert ? alertId : undefined}
          >
            {mode === "create" ? "Agregar" : "Guardar"}
          </Button>
        </DialogFooter>
      </form>
    </AppDialog>
  );
}
