"use client";

import { Trash2 } from "lucide-react";
import { useId, useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  ALERT_DOLLAR_LABELS,
  ALERT_DOLLARS,
  type AlertDollar,
  alertLine,
  MAX_ALERTS,
  type NewAlert,
  type PriceAlert,
} from "@/lib/alerts/alerts";
import { parseAmountInput } from "@/lib/format/amount";

const INSTRUMENT = "instrument";
const DIRECTION_LABELS = { above: "Sube a", below: "Baja a" } as const;
const INVALID_PRICE =
  "Ingresá un precio mayor a cero, con coma para los decimales.";
const INVALID_SYMBOL = "Ingresá el ticker del activo, como AL30 o BTC.";

// The user's price alerts: each one waiting or met, a form to set another,
// and the way to delete one. Both change the list at once and come back if
// the server refuses.
export function AlertsCard({
  alerts,
  onCreate,
  onDelete,
}: {
  alerts: readonly PriceAlert[];
  onCreate: (alert: NewAlert) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
}) {
  const [shown, change] = useOptimistic(
    alerts,
    (
      current: readonly PriceAlert[],
      update: { add: PriceAlert } | { remove: string },
    ) =>
      "add" in update
        ? [update.add, ...current]
        : current.filter((each) => each.id !== update.remove),
  );
  const [, startTransition] = useTransition();

  const create = (alert: NewAlert) =>
    startTransition(async () => {
      change({
        add: {
          ...alert,
          id: `pending-${crypto.randomUUID()}`,
          metOn: null,
          metPrice: null,
          seenAt: null,
        },
      });
      if (await onCreate(alert).catch(() => false)) {
        toast.success("Creaste la alerta.");
      } else {
        toast.error(
          shown.length >= MAX_ALERTS
            ? `Ya tenés ${MAX_ALERTS} alertas. Borrá alguna para crear otra.`
            : "No pudimos crear la alerta. Probá de nuevo.",
        );
      }
    });

  const remove = (id: string) =>
    startTransition(async () => {
      change({ remove: id });
      if (!(await onDelete(id).catch(() => false))) {
        toast.error("No pudimos borrar la alerta. Probá de nuevo.");
      }
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Alertas de precio</CardTitle>
        <CardDescription>
          Te avisamos en el Resumen cuando un dólar o un activo llegue al precio
          que elijas. Miramos las cotizaciones cada hora desde el cierre del
          mercado.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <AlertForm onCreate={create} />
        {shown.length > 0 && (
          <ul className="grid gap-2">
            {shown.map((alert) => (
              <li
                key={alert.id}
                className="flex items-center justify-between gap-2 rounded-md border p-3 text-sm"
              >
                <span className="grid">
                  <span>{alertLine(alert)}</span>
                  <span className="text-muted-foreground text-xs">
                    {alert.metOn === null ? "Esperando" : "Ya te avisamos"}
                  </span>
                </span>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  aria-label={`Borrar la alerta: ${alertLine(alert)}`}
                  disabled={alert.id.startsWith("pending-")}
                  onClick={() => remove(alert.id)}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// A dollar or an instrument, which way and at what price.
function AlertForm({ onCreate }: { onCreate: (alert: NewAlert) => void }) {
  const id = useId();
  const [subject, setSubject] = useState<AlertDollar | typeof INSTRUMENT>(
    "mep",
  );
  const [symbol, setSymbol] = useState("");
  const [currency, setCurrency] = useState<"ARS" | "USD">("USD");
  const [direction, setDirection] = useState<"above" | "below">("above");
  const [price, setPrice] = useState("");
  const [alert, setAlert] = useState<string | null>(null);

  return (
    <form
      className="grid gap-3"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const threshold = parseAmountInput(price);
        if (threshold === null || threshold === "0") {
          return setAlert(INVALID_PRICE);
        }
        const ticker = symbol.trim().toUpperCase();
        if (subject === INSTRUMENT && !/^[A-Z0-9]{1,15}$/.test(ticker)) {
          return setAlert(INVALID_SYMBOL);
        }
        setAlert(null);
        setPrice("");
        onCreate(
          subject === INSTRUMENT
            ? {
                subjectKind: "instrument",
                subject: ticker,
                direction,
                threshold,
                currency,
              }
            : {
                subjectKind: "dollar",
                subject,
                direction,
                threshold,
                currency: "ARS",
              },
        );
      }}
    >
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="grid gap-2">
          <Label htmlFor={`${id}-subject`}>Qué mirar</Label>
          <Select
            value={subject}
            onValueChange={(value) => setSubject(value as typeof subject)}
          >
            <SelectTrigger id={`${id}-subject`} className="w-full">
              <SelectValue>
                {subject === INSTRUMENT
                  ? "Un activo"
                  : ALERT_DOLLAR_LABELS[subject]}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {ALERT_DOLLARS.map((each) => (
                <SelectItem key={each} value={each}>
                  {ALERT_DOLLAR_LABELS[each]}
                </SelectItem>
              ))}
              <SelectItem value={INSTRUMENT}>Un activo</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {subject === INSTRUMENT && (
          <div className="grid gap-2">
            <Label htmlFor={`${id}-symbol`}>Ticker</Label>
            <Input
              id={`${id}-symbol`}
              autoComplete="off"
              placeholder="AL30"
              aria-invalid={alert === INVALID_SYMBOL || undefined}
              value={symbol}
              onChange={(event) => setSymbol(event.target.value)}
            />
          </div>
        )}
        <div className="grid gap-2">
          <Label htmlFor={`${id}-direction`}>Cuando</Label>
          <Select
            value={direction}
            onValueChange={(value) => setDirection(value as typeof direction)}
          >
            <SelectTrigger id={`${id}-direction`} className="w-full">
              <SelectValue>{DIRECTION_LABELS[direction]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="above">{DIRECTION_LABELS.above}</SelectItem>
              <SelectItem value="below">{DIRECTION_LABELS.below}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${id}-price`}>
            {subject === INSTRUMENT ? "Precio" : "Precio en pesos"}
          </Label>
          <div className="flex gap-2">
            {subject === INSTRUMENT && (
              <Select
                value={currency}
                onValueChange={(value) => setCurrency(value as typeof currency)}
              >
                <SelectTrigger
                  aria-label="Moneda del precio"
                  className="w-20 shrink-0"
                >
                  <SelectValue>{currency === "USD" ? "US$" : "$"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">US$</SelectItem>
                  <SelectItem value="ARS">$</SelectItem>
                </SelectContent>
              </Select>
            )}
            <Input
              id={`${id}-price`}
              inputMode="decimal"
              autoComplete="off"
              aria-invalid={alert === INVALID_PRICE || undefined}
              value={price}
              onChange={(event) => setPrice(event.target.value)}
            />
          </div>
        </div>
      </div>
      {alert && <FormAlert>{alert}</FormAlert>}
      <Button type="submit" size="sm" className="justify-self-start">
        Crear alerta
      </Button>
    </form>
  );
}
