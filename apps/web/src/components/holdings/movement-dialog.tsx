"use client";

import {
  CHARGE_KINDS,
  type ChargeKind,
  isIncome,
  type MovementKind,
} from "@plant/core";
import type { Currency } from "@plant/shared";
import { Plus, X } from "lucide-react";
import type * as React from "react";
import { useId, useMemo, useState } from "react";

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
import { instrumentLabel } from "@/lib/holdings/holding-name";
import { formatQuotedPrice, priceBasisLabel } from "@/lib/holdings/price-input";
import type { MovementsInput } from "@/lib/holdings/movements-input";
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
  kindsOffered,
  toOperationInput,
  priceInField,
  withKind,
  withShownPrice,
} from "./movement-fields";

const DIRECTION_LABELS = { in: "Entran unidades", out: "Salen unidades" };
const YIELD_LABELS = { in: "Ganancia", out: "Pérdida" };
// The charges whose name the user writes: one that must say what it is, and a
// tax that may say which.
const NAMED_CHARGES: readonly ChargeKind[] = ["tax", "other"];

// Records an operation of an instrument in one account, split across
// portfolios, or edits one; it hands its fields to `onSubmit` as it closes,
// and a refused write opens it again with the fields and the alert. An
// operation opened from a holding, or edited, keeps its account and
// instrument. A page that passes `transfer` offers a new operation moving
// units out of `from` into another portfolio; an edited transfer stays one.
// One that passes `yields` offers yields in `portfolio`'s holding, valued at
// the day's quote unless the user types another value.
export function MovementDialog({
  mode,
  accounts,
  portfolios,
  instruments,
  fixed,
  transfer,
  yields,
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
  yields?: {
    portfolio: string;
    quoteOn: NonNullable<MovementsInput["quoteOn"]>;
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
  const yielding = fields.kind === "yield";
  const kinds = kindsOffered({
    editing: mode === "edit" ? initial.kind : null,
    offers: new Set([
      ...(transfer ? (["transfer"] as const) : []),
      ...(yields ? (["yield"] as const) : []),
    ]),
  });
  const destinationId = `${fieldId("parts")}-to`;
  const costHelpId = `${fieldId("price")}-help`;
  const modeId = `${id}-mode`;
  const balanceHelpId = `${fieldId("parts")}-help`;
  // A transfer with no portfolio to move to points its alert there.
  const noDestination = moving && !fields.parts[1]?.portfolioId;
  const controlId = (field: MovementField) =>
    field === "parts" && noDestination ? destinationId : fieldId(field);
  const { instrument, currency, date } = fields;
  const quote = useMemo(
    () =>
      yielding && yields
        ? yields.quoteOn({ symbol: instrument, currency, date })
        : null,
    [yielding, yields, instrument, currency, date],
  );
  const suggested = moving ? (transfer?.suggestedCost(fields) ?? null) : quote;
  // A price shown as a suggestion until the user changes it.
  const suggesting = moving || yielding;
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
    const sent = withShownPrice(fields, suggested, instrumentType);
    const parsed = operationInputSchema.safeParse(
      toOperationInput(sent, instrumentType),
    );
    if (!parsed.success) {
      const refused = movementRefusal(parsed.error, fields);
      setAlert(refused);
      if (refused.field)
        document.getElementById(controlId(refused.field))?.focus();
      return;
    }
    setAlert(undefined);
    if (!onSubmit(sent)) return;
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
          : "Una compra, una venta, un cobro o un ajuste de un instrumento."
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
                  withKind(current, value, {
                    transfer: transfer?.from,
                    yield: yields?.portfolio,
                  }),
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
            {suggesting && (
              <div className="grid gap-2">
                <Label htmlFor={fieldId("price")}>
                  {moving ? `Costo ${basis}` : `Valor ${basis}`}
                </Label>
                <Input
                  id={fieldId("price")}
                  {...control("price")}
                  aria-describedby={
                    invalid("price") ? `${alertId} ${costHelpId}` : costHelpId
                  }
                  autoFocus={firstField === "price"}
                  inputMode="decimal"
                  autoComplete="off"
                  value={priceInField(fields, suggested, instrumentType)}
                  onChange={(event) => {
                    setFields((current) => ({
                      ...current,
                      price: event.target.value,
                      priceEdited: true,
                    }));
                    settle("price");
                  }}
                />
              </div>
            )}
            {!income &&
              !suggesting &&
              !(adjustment && fields.direction === "out") &&
              textField(
                "price",
                adjustment ? `Costo ${basis} (opcional)` : `Precio ${basis}`,
                { inputMode: "decimal" },
              )}
          </div>

          {suggesting && (
            <div
              id={costHelpId}
              className="-mt-2 grid gap-1 text-xs text-muted-foreground"
            >
              {suggested === null ? (
                <p>
                  {moving
                    ? "Si lo dejás vacío, entran con el costo que tenían."
                    : fields.priceEdited && fields.price.trim() !== ""
                      ? "No hay precio en esa moneda para ese día."
                      : `No hay precio en esa moneda para ese día: ingresá el valor ${basis}.`}
                </p>
              ) : fields.priceEdited ? (
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
                        priceEdited: false,
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
              ) : (
                <p>
                  {moving
                    ? "Sugerido: el costo que tenían."
                    : "Sugerido: el precio de ese día."}
                </p>
              )}
              <p>
                {moving
                  ? "Si lo cambiás, entran con ese costo y la diferencia se ve en el resultado de la tenencia."
                  : "Lo que valían las unidades ese día cuenta como rendimiento, no como plata que pusiste o sacaste."}
              </p>
            </div>
          )}

          {yielding ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor={modeId}>Cargar</Label>
                <Select
                  value={fields.balance === null ? "change" : "balance"}
                  onValueChange={choose((value) => {
                    setFields((current) => ({
                      ...current,
                      balance: value === "balance" ? "" : null,
                    }));
                    settle("parts");
                  })}
                >
                  <SelectTrigger id={modeId} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="change">Lo que ganó o perdió</SelectItem>
                    <SelectItem value="balance">El saldo final</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {fields.balance === null ? (
                select(
                  "direction",
                  "Resultado",
                  fields.direction,
                  (["in", "out"] as const).map((each) => [
                    each,
                    YIELD_LABELS[each],
                  ]),
                  (value) => set("direction")(value),
                )
              ) : (
                <span aria-hidden />
              )}
              <div className="grid gap-2">
                <Label htmlFor={fieldId("parts")}>
                  {fields.balance === null ? "Cantidad" : "Saldo final"}
                </Label>
                <Input
                  id={fieldId("parts")}
                  {...control("parts")}
                  aria-describedby={
                    [
                      ...(invalid("parts") ? [alertId] : []),
                      ...(fields.balance === null ? [] : [balanceHelpId]),
                    ].join(" ") || undefined
                  }
                  autoFocus={firstField === "parts"}
                  inputMode="decimal"
                  autoComplete="off"
                  value={fields.balance ?? fields.parts[0]?.size ?? ""}
                  onChange={(event) => {
                    const typed = event.target.value;
                    setFields((current) =>
                      current.balance === null
                        ? {
                            ...current,
                            parts: current.parts.map((part) => ({
                              ...part,
                              size: typed,
                            })),
                          }
                        : { ...current, balance: typed },
                    );
                    settle("parts");
                  }}
                />
              </div>
              {fields.balance !== null && (
                <p
                  id={balanceHelpId}
                  className="col-span-2 -mt-2 text-xs text-muted-foreground"
                >
                  Las unidades que tenías al terminar ese día. La diferencia con
                  lo que ya tenías se carga como rendimiento.
                </p>
              )}
            </div>
          ) : moving ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_1fr_8rem]">
              <div className="grid gap-2">
                <span className="text-sm font-medium">Desde</span>
                <span className="flex h-9 min-w-0 items-center truncate text-sm">
                  {portfolios.find(
                    (each) => each.id === fields.parts[0]?.portfolioId,
                  )?.name ?? ""}
                </span>
              </div>
              <div className="grid gap-2">
                <Label htmlFor={destinationId}>Hacia</Label>
                <Select
                  value={fields.parts[1]?.portfolioId ?? ""}
                  onValueChange={pick("parts", (value) =>
                    setPart(1, { portfolioId: value }),
                  )}
                >
                  <SelectTrigger
                    id={destinationId}
                    {...control("parts")}
                    autoFocus={firstField === "parts" && noDestination}
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
              <div className="col-span-2 grid gap-2 sm:col-span-1">
                <Label htmlFor={fieldId("parts")}>Cantidad</Label>
                <Input
                  id={fieldId("parts")}
                  {...control("parts")}
                  autoFocus={firstField === "parts" && !noDestination}
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

          {!suggesting && (
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
