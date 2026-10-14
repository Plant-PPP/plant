"use client";

import { DialogActions } from "@/components/ui/dialog-actions";
import type { Denominator, RealEstateFigures } from "@plant/core";
import { Constants, type Currency } from "@plant/shared";
import { useId, useState } from "react";

import {
  choose,
  useFieldAlert,
} from "@/components/portfolio-setup/field-alert";
import { useSavedFocus } from "@/components/portfolio-setup/saved-focus";
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
import { formatAmount, formatFraction } from "@/lib/format/amount";
import {
  PAYMENT_LABELS,
  PAYMENTS,
  PROPERTY_KIND_LABELS,
  PROPERTY_KINDS,
  type RealEstateSheet,
  RENT_INDEX_LABELS,
  RENT_INDEXES,
} from "@/lib/real-estate/sheet";

import {
  SHEET_MESSAGES,
  type SheetField,
  type SheetFields,
  toSheet,
} from "./real-estate-fields";

const CURRENCIES: readonly Currency[] = Constants.public.Enums.currency;
const NO_INDEX = "none";

const fieldOf = (text: string): SheetField | null =>
  (Object.keys(SHEET_MESSAGES) as SheetField[]).find(
    (field) => SHEET_MESSAGES[field] === text,
  ) ?? null;

// A select whose trigger shows the chosen option's text, so the server render
// shows it too.
function Choice<V extends string>({
  id,
  label,
  value,
  options,
  onChange,
  invalid,
  describedBy,
}: {
  id: string;
  label: string;
  value: V;
  options: readonly (readonly [V, string])[];
  onChange: (value: V) => void;
  invalid?: boolean;
  describedBy?: string;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Select
        value={value}
        onValueChange={choose((next) => onChange(next as V))}
      >
        <SelectTrigger
          id={id}
          className="w-full"
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
        >
          <SelectValue>
            {options.find(([option]) => option === value)?.[1]}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map(([option, text]) => (
            <SelectItem key={option} value={option}>
              {text}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// A property's sheet: what it is, what it cost, its rent and expenses, how
// the rent is adjusted and how it was paid, with what that leaves each month,
// its yield and what it gained, in the page's unit, as the fields read.
export function RealEstateDialog({
  name,
  initial,
  initialError,
  liabilities,
  unit,
  figures,
  returnFocusTo,
  onClose,
  onSubmit,
}: {
  name: string;
  initial: SheetFields;
  initialError?: string;
  // The user's debts a mortgage or installments can be.
  liabilities: readonly { id: string; label: string }[];
  unit: Denominator;
  figures: (sheet: RealEstateSheet) => RealEstateFigures;
  returnFocusTo: () => HTMLElement | null;
  onClose: () => void;
  // False when the write could not start; the dialog stays open.
  onSubmit: (sheet: RealEstateSheet) => boolean;
}) {
  const id = useId();
  const fieldId = (field: string) => `${id}-${field}`;
  const alertId = `${id}-alert`;
  const [fields, setFields] = useState(initial);
  const { alert, setAlert, firstField, invalid, settle } =
    useFieldAlert<SheetField>(initialError, fieldOf, "purchasePrice");
  const focus = useSavedFocus(returnFocusTo, false);
  const read = toSheet(fields);
  const shown = "sheet" in read ? figures(read.sheet) : null;

  const set =
    <K extends keyof SheetFields>(key: K) =>
    (value: SheetFields[K]) => {
      setFields((current) => ({ ...current, [key]: value }));
      if (key in SHEET_MESSAGES) settle(key as SheetField);
    };
  const text = (field: SheetField & keyof SheetFields, label: string) => (
    <div className="grid gap-2">
      <Label htmlFor={fieldId(field)}>{label}</Label>
      <Input
        id={fieldId(field)}
        inputMode={field === "purchaseDate" ? undefined : "decimal"}
        type={field === "purchaseDate" ? "date" : undefined}
        autoComplete="off"
        autoFocus={firstField === field}
        aria-invalid={invalid(field) || undefined}
        aria-describedby={invalid(field) ? alertId : undefined}
        value={fields[field]}
        onChange={(event) => set(field)(event.target.value)}
      />
    </div>
  );
  const currency = (
    field: "purchaseCurrency" | "rentCurrency" | "expensesCurrency",
  ) => (
    <Choice
      id={fieldId(field)}
      label="Moneda"
      value={fields[field]}
      options={CURRENCIES.map((each) => [each, each] as const)}
      onChange={set(field)}
    />
  );

  function submit() {
    if ("refused" in read) {
      setAlert({ field: read.refused, text: SHEET_MESSAGES[read.refused] });
      document.getElementById(fieldId(read.refused))?.focus();
      return;
    }
    setAlert(undefined);
    if (!onSubmit(read.sheet)) return;
    focus.markSaved();
    onClose();
  }

  const money = (amount: string | null | undefined) =>
    amount == null ? "—" : formatAmount(amount, unit);
  const fraction = (value: string | null | undefined) =>
    value == null ? "—" : formatFraction(value);

  return (
    <AppDialog
      onClose={onClose}
      title="Ficha del inmueble"
      description={name}
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
        <Choice
          id={fieldId("kind")}
          label="Tipo"
          value={fields.kind}
          options={PROPERTY_KINDS.map(
            (each) => [each, PROPERTY_KIND_LABELS[each]] as const,
          )}
          onChange={set("kind")}
        />
        <fieldset className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <legend className="mb-2 text-sm font-medium">Compra</legend>
          {text("purchasePrice", "Precio")}
          {currency("purchaseCurrency")}
          {text("purchaseDate", "Fecha")}
        </fieldset>
        <fieldset className="grid grid-cols-2 gap-3">
          <legend className="mb-2 text-sm font-medium">Por mes</legend>
          {text("rent", "Alquiler")}
          {currency("rentCurrency")}
          {text("expenses", "Expensas, ABL e impuestos")}
          {currency("expensesCurrency")}
        </fieldset>
        <div className="grid grid-cols-2 gap-3">
          <Choice
            id={fieldId("index")}
            label="Ajuste del alquiler"
            value={fields.index}
            options={[
              [NO_INDEX, "Sin ajuste"] as const,
              ...RENT_INDEXES.map(
                (each) => [each, RENT_INDEX_LABELS[each]] as const,
              ),
            ]}
            onChange={set("index")}
          />
          {fields.index !== NO_INDEX && text("everyMonths", "Cada (meses)")}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Choice
            id={fieldId("payment")}
            label="Forma de pago"
            value={fields.payment}
            options={PAYMENTS.map(
              (each) => [each, PAYMENT_LABELS[each]] as const,
            )}
            onChange={set("payment")}
          />
          {fields.payment !== "cash" && (
            <Choice
              id={fieldId("liabilityId")}
              label="Deuda"
              value={fields.liabilityId}
              options={liabilities.map(
                (each) => [each.id, each.label] as const,
              )}
              onChange={set("liabilityId")}
              invalid={invalid("liabilityId")}
              describedBy={invalid("liabilityId") ? alertId : undefined}
            />
          )}
        </div>
        <dl
          aria-live="polite"
          className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border p-3 text-sm"
        >
          <dt className="text-muted-foreground">Renta neta por mes</dt>
          <dd className="tabular-nums">{money(shown?.netMonthly)}</dd>
          <dt className="text-muted-foreground">Rendimiento anual</dt>
          <dd className="tabular-nums">{fraction(shown?.rentalYield)}</dd>
          <dt className="text-muted-foreground">Valorización</dt>
          <dd className="tabular-nums">
            {shown?.appreciation
              ? `${money(shown.appreciation.amount)} (${fraction(shown.appreciation.share)})`
              : "—"}
          </dd>
        </dl>
        <p className="text-muted-foreground -mt-2 text-xs">
          La renta neta resta los gastos y la cuota de la deuda. Sin ajuste por
          inflación.
        </p>
        {alert && <FormAlert id={alertId}>{alert.text}</FormAlert>}
        <DialogActions
          submitLabel="Guardar"
          describedBy={alert ? alertId : undefined}
        />
      </form>
    </AppDialog>
  );
}
