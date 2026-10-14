"use client";

import type { Currency } from "@plant/shared";
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
  type AlertWriteResult,
  MAX_ALERTS,
  type NewAlert,
  newAlertSchema,
  type PriceAlert,
} from "@/lib/alerts/alerts";
import { currencySymbol, parseAmountInput } from "@/lib/format/amount";
import { settle } from "@/lib/server-action-call";

// An instrument the user holds, which an alert can watch, and the currency
// it is quoted in.
export type AlertInstrument = { symbol: string; currency: Currency };

const PRICE = "price";
const GAIN = "gain";
type Subject = AlertDollar | typeof PRICE | typeof GAIN;

const SUBJECT_LABELS: Record<typeof PRICE | typeof GAIN, string> = {
  price: "Precio de un activo",
  gain: "Ganancia de un activo",
};
const DIRECTION_LABELS = {
  price: { above: "Sube a", below: "Baja a" },
  gain: { above: "Gana", below: "Pierde" },
} as const;
const INVALID_PRICE =
  "Ingresá un precio mayor a cero, con coma para los decimales.";
const INVALID_PERCENT =
  "Ingresá un porcentaje mayor a cero, con coma para los decimales; una pérdida, menor a 100.";
const REFUSED: Record<Exclude<AlertWriteResult, "ok">, string> = {
  invalid: "Revisá los datos de la alerta.",
  full: `Ya tenés ${MAX_ALERTS} alertas. Borrá alguna para crear otra.`,
  unknown_instrument: "No encontramos ese activo.",
  failed: "No pudimos crear la alerta. Probá de nuevo.",
};

// The user's alerts: each one waiting or met, a form to set another, and the
// way to delete one. Both change the list at once and come back if the
// server refuses.
export function AlertsCard({
  alerts,
  instruments,
  readFailed = false,
  onCreate,
  onDelete,
}: {
  alerts: readonly PriceAlert[];
  instruments: readonly AlertInstrument[];
  readFailed?: boolean;
  onCreate: (alert: NewAlert) => Promise<AlertWriteResult>;
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

  const create = (alert: NewAlert, pending: PriceAlert) =>
    new Promise<boolean>((resolve) =>
      startTransition(async () => {
        change({ add: pending });
        const settled = await settle(onCreate(alert));
        const result = settled === "rejected" ? "failed" : settled;
        if (result === "ok") toast.success("Creaste la alerta.");
        else toast.error(REFUSED[result]);
        resolve(result === "ok");
      }),
    );

  const remove = (id: string) =>
    startTransition(async () => {
      change({ remove: id });
      if ((await settle(onDelete(id))) !== true) {
        toast.error("No pudimos borrar la alerta. Probá de nuevo.");
      }
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Alertas de precio</CardTitle>
        <CardDescription>
          Te avisamos en el Resumen cuando un dólar o un activo llegue al precio
          que elijas, o cuando un activo que tenés gane o pierda un porcentaje
          sobre tu costo promedio. Miramos las cotizaciones cada hora desde el
          cierre del mercado; un activo sin cotización automática, como un bono
          o un CEDEAR, usa el último precio que cargues a mano.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <AlertForm instruments={instruments} onCreate={create} />
        {readFailed && (
          <FormAlert>
            No pudimos leer tus alertas. Recargá la página para verlas.
          </FormAlert>
        )}
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
                  className="size-7 shrink-0"
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

// A dollar's or an instrument's price, which way and at what figure; or an
// instrument's gain or loss over its cost, in percent.
function AlertForm({
  instruments,
  onCreate,
}: {
  instruments: readonly AlertInstrument[];
  onCreate: (alert: NewAlert, pending: PriceAlert) => Promise<boolean>;
}) {
  const id = useId();
  const [subject, setSubject] = useState<Subject>("mep");
  const [symbol, setSymbol] = useState(instruments[0]?.symbol ?? "");
  const [direction, setDirection] = useState<"above" | "below">("above");
  const [figure, setFigure] = useState("");
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const onInstrument = subject === PRICE || subject === GAIN;
  const instrument = instruments.find((each) => each.symbol === symbol);
  const directions =
    subject === GAIN ? DIRECTION_LABELS.gain : DIRECTION_LABELS.price;

  const submit = async () => {
    if (onInstrument && !instrument) {
      return setAlert("Elegí un activo que tengas.");
    }
    const value = parseAmountInput(figure);
    const pending = (
      fields: Pick<PriceAlert, "subjectKind" | "subject" | "currency"> &
        Partial<PriceAlert>,
    ): PriceAlert => ({
      id: `pending-${crypto.randomUUID()}`,
      direction,
      threshold: null,
      gainPercent: null,
      costPrice: null,
      metOn: null,
      metPrice: null,
      seenAt: null,
      ...fields,
    });
    let input: NewAlert;
    let shown: PriceAlert;
    if (subject === GAIN) {
      input = {
        subjectKind: "gain",
        subject: symbol,
        direction,
        percent: value ?? "",
      };
      shown = pending({
        subjectKind: "instrument",
        subject: symbol,
        currency: instrument!.currency,
        gainPercent: value,
      });
    } else if (subject === PRICE) {
      input = {
        subjectKind: "instrument",
        subject: symbol,
        direction,
        threshold: value ?? "",
        currency: instrument!.currency,
      };
      shown = pending({ ...input, threshold: value });
    } else {
      input = {
        subjectKind: "dollar",
        subject,
        direction,
        threshold: value ?? "",
        currency: "ARS",
      };
      shown = pending({ ...input, threshold: value });
    }
    if (value === null || !newAlertSchema.safeParse(input).success) {
      return setAlert(subject === GAIN ? INVALID_PERCENT : INVALID_PRICE);
    }
    setAlert(null);
    setBusy(true);
    try {
      if (await onCreate(input, shown)) setFigure("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="grid gap-3"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="grid gap-2">
          <Label htmlFor={`${id}-subject`}>Qué mirar</Label>
          <Select
            value={subject}
            onValueChange={(value) => setSubject(value as Subject)}
          >
            <SelectTrigger id={`${id}-subject`} className="w-full">
              <SelectValue>
                {subject === PRICE || subject === GAIN
                  ? SUBJECT_LABELS[subject]
                  : ALERT_DOLLAR_LABELS[subject]}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {ALERT_DOLLARS.map((each) => (
                <SelectItem key={each} value={each}>
                  {ALERT_DOLLAR_LABELS[each]}
                </SelectItem>
              ))}
              {instruments.length > 0 && (
                <>
                  <SelectItem value={PRICE}>{SUBJECT_LABELS.price}</SelectItem>
                  <SelectItem value={GAIN}>{SUBJECT_LABELS.gain}</SelectItem>
                </>
              )}
            </SelectContent>
          </Select>
        </div>
        {onInstrument && (
          <div className="grid gap-2">
            <Label htmlFor={`${id}-symbol`}>Activo</Label>
            <Select value={symbol} onValueChange={setSymbol}>
              <SelectTrigger id={`${id}-symbol`} className="w-full">
                <SelectValue>{symbol}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {instruments.map((each) => (
                  <SelectItem key={each.symbol} value={each.symbol}>
                    {each.symbol}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="grid gap-2">
          <Label htmlFor={`${id}-direction`}>Cuando</Label>
          <Select
            value={direction}
            onValueChange={(value) => setDirection(value as typeof direction)}
          >
            <SelectTrigger id={`${id}-direction`} className="w-full">
              <SelectValue>{directions[direction]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="above">{directions.above}</SelectItem>
              <SelectItem value="below">{directions.below}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${id}-figure`}>
            {subject === GAIN
              ? "Porcentaje"
              : subject === PRICE
                ? `Precio en ${currencySymbol(instrument?.currency ?? "ARS")}`
                : "Precio en $"}
          </Label>
          <Input
            id={`${id}-figure`}
            inputMode="decimal"
            autoComplete="off"
            placeholder={subject === GAIN ? "20" : undefined}
            aria-invalid={alert !== null || undefined}
            value={figure}
            onChange={(event) => setFigure(event.target.value)}
          />
        </div>
      </div>
      {alert && <FormAlert>{alert}</FormAlert>}
      <Button
        type="submit"
        size="sm"
        className="justify-self-start"
        disabled={busy}
      >
        Crear alerta
      </Button>
    </form>
  );
}
