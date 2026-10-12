"use client";

import {
  CHARGE_KINDS,
  type ChargeKind,
  isIncome,
  MOVEMENT_KINDS,
  type MovementKind,
  quotedPrice,
} from "@plant/core";
import type { Currency } from "@plant/shared";
import { Plus, X } from "lucide-react";
import type * as React from "react";
import { useId, useState } from "react";

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
import {
  choose,
  useFieldAlert,
} from "@/components/portfolio-setup/field-alert";
import { useSavedFocus } from "@/components/portfolio-setup/saved-focus";
import {
  CHARGE_KIND_LABELS,
  CURRENCY_LABELS,
  MOVEMENT_KIND_LABELS,
} from "@/lib/holdings/messages";
import { amountInput } from "@/lib/format/amount";
import { instrumentLabel } from "@/lib/holdings/holding-name";
import { formatQuotedPrice, priceBasisLabel } from "@/lib/holdings/price-input";
import type { InstrumentRow } from "@/lib/holdings/read";
import { operationInputSchema } from "@/lib/holdings/schemas";
import type {
  PortfolioRow,
  SourceConnectionRow,
} from "@/lib/portfolio-setup/read";

import {
  type MovementField,
  type MovementFields,
  movementRefusal,
  refusedMovementField,
  toOperationInput,
  withKind,
} from "./movement-fields";

const DIRECTION_LABELS = { in: "Entran unidades", out: "Salen unidades" };
// The charges whose name the user writes: one that must say what it is, and a
// tax that may say which.
const NAMED_CHARGES: readonly ChargeKind[] = ["tax", "other"];

// Records an operation of an instrument in one account, split across
// portfolios, or edits one; it hands its fields to `onSubmit` as it closes,
// and a refused write opens it again with the fields and the alert. An
// operation opened from a holding, or edited, keeps its account and
// instrument. A page that passes `transfer` offers moving units out of
// `from` into another portfolio; an edit of a transfer stays one.
export function MovementDialog({
  mode,
  accounts,
  portfolios,
  instruments,
  fixed,
  transfer,
  initial,
  initialError,
  today,
  returnFocusTo,
  onClose,
  onSubmit,
}: {
  mode: "create" | "edit";
  accounts: SourceConnectionRow[];
  portfolios: PortfolioRow[];
  instruments: InstrumentRow[];
  // The account and instrument, named, when they cannot change.
  fixed?: { account: string; instrument: string };
  transfer?: {
    from: string;
    // The cost per unit the units would carry, as stored; null when none.
    suggestedCost: (fields: MovementFields) => string | null;
  };
  initial: MovementFields;
  initialError?: string;
  today: string;
  returnFocusTo: () => HTMLElement | null;
  onClose: () => void;
  // False when the write could not start; the dialog stays open.
  onSubmit: (fields: MovementFields) => boolean;
}) {
  const id = useId();
  const fieldId = (field: MovementField) => `${id}-${field}`;
  const alertId = `${id}-alert`;
  const [fields, setFields] = useState(initial);
  const { alert, setAlert, firstField, invalid, settle, pick } =
    useFieldAlert<MovementField>(initialError, refusedMovementField, "kind");
  const focus = useSavedFocus(returnFocusTo, false);
  const income = isIncome(fields.kind);
  const instrumentType =
    instruments.find((each) => each.symbol === fields.instrument)?.type ?? null;
  const basis = instrumentType ? priceBasisLabel(instrumentType) : "por unidad";
  const adjustment = fields.kind === "adjustment";
  const moving = fields.kind === "transfer";
  const kinds =
    mode === "edit" && initial.kind === "transfer"
      ? (["transfer"] as const)
      : MOVEMENT_KINDS.filter((each) => transfer || each !== "transfer");
  const suggested = moving ? (transfer?.suggestedCost(fields) ?? null) : null;
  const shownCost = (cost: string) =>
    amountInput(instrumentType ? quotedPrice(instrumentType, cost) : cost);
  const unused = portfolios.filter(
    (each) => !fields.parts.some((part) => part.portfolioId === each.id),
  );

  const set =
    <K extends keyof MovementFields>(key: K) =>
    (value: MovementFields[K]) =>
      setFields((current) => ({ ...current, [key]: value }));
  const setPart = (
    index: number,
    change: Partial<MovementFields["parts"][0]>,
  ) =>
    setFields((current) => ({
      ...current,
      parts: current.parts.map((part, at) =>
        at === index ? { ...part, ...change } : part,
      ),
    }));
  const setCharge = (
    index: number,
    change: Partial<MovementFields["charges"][0]>,
  ) =>
    setFields((current) => ({
      ...current,
      charges: current.charges.map((charge, at) =>
        at === index ? { ...charge, ...change } : charge,
      ),
    }));

  const control = (field: MovementField) => ({
    "aria-invalid": invalid(field),
    "aria-describedby": invalid(field) && alertId,
  });

  function submit() {
    const parsed = operationInputSchema.safeParse(
      toOperationInput(fields, instrumentType),
    );
    if (!parsed.success) {
      const refused = movementRefusal(parsed.error);
      setAlert(refused);
      if (refused.field)
        document.getElementById(fieldId(refused.field))?.focus();
      return;
    }
    setAlert(undefined);
    if (!onSubmit(fields)) return;
    focus.markSaved();
    onClose();
  }

  const select = <V extends string>(
    field: MovementField,
    label: string,
    value: V,
    options: readonly (readonly [V, string])[],
    onChange: (value: V) => void,
  ) => (
    <div className="grid gap-2">
      <Label htmlFor={fieldId(field)}>{label}</Label>
      <Select
        value={value}
        onValueChange={pick(field, (next) => onChange(next as V))}
      >
        <SelectTrigger
          id={fieldId(field)}
          {...control(field)}
          autoFocus={firstField === field}
          className="w-full"
        >
          <SelectValue />
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

  const textField = (
    field: "date" | "price" | "reference" | "note",
    label: string,
    props: React.ComponentProps<typeof Input> = {},
  ) => (
    <div className="grid gap-2">
      <Label htmlFor={fieldId(field)}>{label}</Label>
      <Input
        id={fieldId(field)}
        {...control(field)}
        autoFocus={firstField === field}
        value={fields[field]}
        onChange={(event) => {
          set(field)(event.target.value);
          settle(field);
        }}
        autoComplete="off"
        {...props}
      />
    </div>
  );

  return (
    <AppDialog
      onClose={onClose}
      title={mode === "create" ? "Agregar movimiento" : "Editar movimiento"}
      description={
        fixed
          ? `${fixed.instrument} en ${fixed.account}`
          : "Una compra, una venta, un cobro, un ajuste o un traspaso de un instrumento."
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
          <div className="grid grid-cols-2 gap-3">
            {select(
              "kind",
              "Tipo",
              fields.kind,
              kinds.map((each) => [each, MOVEMENT_KIND_LABELS[each]]),
              (value: MovementKind) =>
                setFields((current) =>
                  withKind(
                    current,
                    value,
                    transfer?.from ?? current.parts[0]?.portfolioId ?? "",
                  ),
                ),
            )}
            {adjustment
              ? select(
                  "direction",
                  "Unidades",
                  fields.direction,
                  (["in", "out"] as const).map((each) => [
                    each,
                    DIRECTION_LABELS[each],
                  ]),
                  (value) => set("direction")(value),
                )
              : textField("date", "Fecha", { type: "date", max: today })}
          </div>
          {adjustment &&
            textField("date", "Fecha", { type: "date", max: today })}
          {!fixed && (
            <div className="grid grid-cols-2 gap-3">
              {select(
                "account",
                "Cuenta",
                fields.accountId,
                accounts.map((each) => [each.id, each.institution]),
                (value) => set("accountId")(value),
              )}
              {select(
                "instrument",
                "Instrumento",
                fields.instrument,
                instruments.map((each) => [
                  each.symbol,
                  instrumentLabel(each.symbol, each.name),
                ]),
                (value) => {
                  const instrument = instruments.find(
                    (each) => each.symbol === value,
                  );
                  setFields((current) => ({
                    ...current,
                    instrument: value,
                    currency: instrument?.currency ?? current.currency,
                  }));
                },
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            {select(
              "currency",
              "Moneda",
              fields.currency,
              (Object.keys(CURRENCY_LABELS) as Currency[]).map((each) => [
                each,
                CURRENCY_LABELS[each],
              ]),
              (value) => set("currency")(value),
            )}
            {moving && (
              <div className="grid gap-2">
                <Label htmlFor={fieldId("price")}>{`Costo ${basis}`}</Label>
                <Input
                  id={fieldId("price")}
                  {...control("price")}
                  aria-describedby={
                    invalid("price") ? alertId : `${fieldId("price")}-help`
                  }
                  autoFocus={firstField === "price"}
                  inputMode="decimal"
                  autoComplete="off"
                  value={
                    fields.costEdited
                      ? fields.price
                      : suggested === null
                        ? ""
                        : shownCost(suggested)
                  }
                  onChange={(event) => {
                    setFields((current) => ({
                      ...current,
                      price: event.target.value,
                      costEdited: true,
                    }));
                    settle("price");
                  }}
                />
              </div>
            )}
            {!income &&
              !moving &&
              !(adjustment && fields.direction === "out") &&
              textField(
                "price",
                adjustment ? `Costo ${basis} (opcional)` : `Precio ${basis}`,
                { inputMode: "decimal" },
              )}
          </div>

          {moving && (
            <div
              id={`${fieldId("price")}-help`}
              className="-mt-2 grid gap-1 text-xs text-muted-foreground"
            >
              {fields.costEdited ? (
                suggested !== null && (
                  <div>
                    <Button
                      type="button"
                      size="sm"
                      variant="link"
                      className="h-auto p-0 text-xs"
                      onClick={() =>
                        setFields((current) => ({
                          ...current,
                          price: "",
                          costEdited: false,
                        }))
                      }
                    >
                      Usar el sugerido (
                      {formatQuotedPrice(
                        suggested,
                        fields.currency,
                        instrumentType,
                      )}
                      )
                    </Button>
                  </div>
                )
              ) : (
                <p>Sugerido: el costo que tenían.</p>
              )}
              <p>
                Si lo cambiás, entran con ese costo, y la diferencia aparece
                cuando las vendas.
              </p>
            </div>
          )}

          {moving ? (
            <div className="grid grid-cols-[1fr_1fr_8rem] gap-3">
              <div className="grid gap-2">
                <span className="text-sm font-medium">Desde</span>
                <span className="flex h-9 items-center text-sm">
                  {portfolios.find(
                    (each) => each.id === fields.parts[0]?.portfolioId,
                  )?.name ?? ""}
                </span>
              </div>
              <div className="grid gap-2">
                <Label htmlFor={fieldId("parts")}>Hacia</Label>
                <Select
                  value={fields.parts[1]?.portfolioId ?? ""}
                  onValueChange={pick("parts", (value) =>
                    setPart(1, { portfolioId: value }),
                  )}
                >
                  <SelectTrigger
                    id={fieldId("parts")}
                    {...control("parts")}
                    autoFocus={firstField === "parts"}
                    className="w-full"
                  >
                    <SelectValue placeholder="Elegí una cartera" />
                  </SelectTrigger>
                  <SelectContent>
                    {portfolios
                      .filter(
                        (each) => each.id !== fields.parts[0]?.portfolioId,
                      )
                      .map((each) => (
                        <SelectItem key={each.id} value={each.id}>
                          {each.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor={`${fieldId("parts")}-quantity`}>Cantidad</Label>
                <Input
                  id={`${fieldId("parts")}-quantity`}
                  {...control("parts")}
                  inputMode="decimal"
                  autoComplete="off"
                  value={fields.parts[0]?.size ?? ""}
                  onChange={(event) => {
                    const size = event.target.value;
                    setFields((current) => ({
                      ...current,
                      parts: current.parts.map((part) => ({ ...part, size })),
                    }));
                    settle("parts");
                  }}
                />
              </div>
            </div>
          ) : (
            <fieldset className="grid gap-2">
              <legend className="mb-2 text-sm font-medium">
                {income ? "Monto por cartera" : "Cantidad por cartera"}
              </legend>
              {fields.parts.map((part, index) => (
                <div
                  key={part.portfolioId || index}
                  className="grid grid-cols-[1fr_8rem_auto] items-center gap-2"
                >
                  <Select
                    value={part.portfolioId}
                    onValueChange={choose((value) => {
                      setPart(index, { portfolioId: value });
                      settle("parts");
                    })}
                  >
                    <SelectTrigger
                      aria-label={`Cartera ${index + 1}`}
                      id={index === 0 ? fieldId("parts") : undefined}
                      {...control("parts")}
                      className="w-full"
                    >
                      <SelectValue placeholder="Elegí una cartera" />
                    </SelectTrigger>
                    <SelectContent>
                      {portfolios
                        .filter(
                          (each) =>
                            each.id === part.portfolioId ||
                            unused.some(({ id }) => id === each.id),
                        )
                        .map((each) => (
                          <SelectItem key={each.id} value={each.id}>
                            {each.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <Input
                    aria-label={`${income ? "Monto" : "Cantidad"} en la cartera ${index + 1}`}
                    {...control("parts")}
                    inputMode="decimal"
                    autoComplete="off"
                    value={part.size}
                    onChange={(event) => {
                      setPart(index, { size: event.target.value });
                      settle("parts");
                    }}
                  />
                  <RemoveButton
                    label={`Quitar la cartera ${index + 1}`}
                    disabled={fields.parts.length === 1}
                    onClick={() =>
                      setFields((current) => ({
                        ...current,
                        parts: current.parts.filter((_, at) => at !== index),
                      }))
                    }
                  />
                </div>
              ))}
              {unused.length > 0 && (
                <div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setFields((current) => ({
                        ...current,
                        parts: [
                          ...current.parts,
                          { portfolioId: unused[0]!.id, size: "" },
                        ],
                      }))
                    }
                  >
                    <Plus />
                    Repartir en otra cartera
                  </Button>
                </div>
              )}
            </fieldset>
          )}

          {!moving && (
            <fieldset className="grid gap-2">
              <legend className="mb-2 text-sm font-medium">
                Gastos (opcional)
              </legend>
              {fields.charges.map((charge, index) => (
                <div
                  key={index}
                  className="grid grid-cols-[9rem_1fr_7rem_auto] items-center gap-2"
                >
                  <Select
                    value={charge.kind}
                    onValueChange={choose((value) => {
                      setCharge(index, { kind: value as ChargeKind });
                      settle("charges");
                    })}
                  >
                    <SelectTrigger
                      aria-label={`Tipo del gasto ${index + 1}`}
                      id={index === 0 ? fieldId("charges") : undefined}
                      {...control("charges")}
                      className="w-full"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CHARGE_KINDS.map((each) => (
                        <SelectItem key={each} value={each}>
                          {CHARGE_KIND_LABELS[each]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {NAMED_CHARGES.includes(charge.kind) ? (
                    <Input
                      aria-label={`Nombre del gasto ${index + 1}`}
                      placeholder={
                        charge.kind === "tax"
                          ? "Sellos, IIBB… (opcional)"
                          : "Nombre"
                      }
                      autoComplete="off"
                      value={charge.label}
                      onChange={(event) => {
                        setCharge(index, { label: event.target.value });
                        settle("charges");
                      }}
                    />
                  ) : (
                    <span aria-hidden />
                  )}
                  <Input
                    aria-label={`Monto del gasto ${index + 1}`}
                    {...control("charges")}
                    inputMode="decimal"
                    autoComplete="off"
                    value={charge.amount}
                    onChange={(event) => {
                      setCharge(index, { amount: event.target.value });
                      settle("charges");
                    }}
                  />
                  <RemoveButton
                    label={`Quitar el gasto ${index + 1}`}
                    disabled={false}
                    onClick={() =>
                      setFields((current) => ({
                        ...current,
                        charges: current.charges.filter(
                          (_, at) => at !== index,
                        ),
                      }))
                    }
                  />
                </div>
              ))}
              <div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setFields((current) => ({
                      ...current,
                      charges: [
                        ...current.charges,
                        { kind: "commission", label: "", amount: "" },
                      ],
                    }))
                  }
                >
                  <Plus />
                  Agregar gasto
                </Button>
              </div>
            </fieldset>
          )}

          <div className="grid grid-cols-2 gap-3">
            {textField("reference", "Referencia (opcional)", {
              placeholder: "N.º de operación",
            })}
            {textField("note", "Nota (opcional)")}
          </div>
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

// Takes a part or a charge out of the operation.
function RemoveButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      title="Quitar"
      disabled={disabled}
      className="size-7 text-muted-foreground hover:text-foreground"
      onClick={onClick}
    >
      <X className="size-3.5" />
    </Button>
  );
}
