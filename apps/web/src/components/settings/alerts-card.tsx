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
  type AlertWriteResult,
  MAX_ALERTS,
  type NewAlert,
  newAlertSchema,
  type PriceAlert,
} from "@/lib/alerts/alerts";
import { parseAmountInput } from "@/lib/format/amount";
import { settle } from "@/lib/server-action-call";

const DIRECTION_LABELS = { above: "Sube a", below: "Baja a" } as const;
export const INVALID_PRICE =
  "Ingresá un precio mayor a cero, con coma para los decimales.";
export const INVALID_PERCENT =
  "Ingresá un porcentaje mayor a cero, con coma para los decimales; una pérdida, menor a 100.";
export const ALERT_REFUSED: Record<Exclude<AlertWriteResult, "ok">, string> = {
  invalid: "Revisá los datos de la alerta.",
  full: `Ya tenés ${MAX_ALERTS} alertas. Borrá alguna para crear otra.`,
  unknown_instrument: "No encontramos ese activo.",
  failed: "No pudimos crear la alerta. Probá de nuevo.",
};

// The user's alerts, a dollar's or an instrument's: each one waiting or met,
// a form to set a dollar's (an instrument's is set from its page), and the
// way to delete one. Both change the list at once and come back if the
// server refuses.
export function AlertsCard({
  alerts,
  readFailed = false,
  onCreate,
  onDelete,
}: {
  alerts: readonly PriceAlert[];
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
        else toast.error(ALERT_REFUSED[result]);
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
          Te avisamos en el Resumen cuando un dólar llegue al precio que elijas.
          Para un activo, creá la alerta desde su página, con la campanita. Acá
          ves y borrás todas.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <AlertForm onCreate={create} />
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

// A dollar's price, which way and at what figure.
function AlertForm({
  onCreate,
}: {
  onCreate: (alert: NewAlert, pending: PriceAlert) => Promise<boolean>;
}) {
  const id = useId();
  const [subject, setSubject] = useState<AlertDollar>("mep");
  const [direction, setDirection] = useState<"above" | "below">("above");
  const [figure, setFigure] = useState("");
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const value = parseAmountInput(figure);
    const input: NewAlert = {
      subjectKind: "dollar",
      subject,
      direction,
      threshold: value ?? "",
      currency: "ARS",
    };
    if (value === null || !newAlertSchema.safeParse(input).success) {
      return setAlert(INVALID_PRICE);
    }
    setAlert(null);
    setBusy(true);
    try {
      const shown: PriceAlert = {
        ...input,
        id: `pending-${crypto.randomUUID()}`,
        threshold: value,
        gainPercent: null,
        costPrice: null,
        metOn: null,
        metPrice: null,
        seenAt: null,
      };
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
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="grid gap-2">
          <Label htmlFor={`${id}-subject`}>Qué dólar</Label>
          <Select
            value={subject}
            onValueChange={(value) => setSubject(value as AlertDollar)}
          >
            <SelectTrigger id={`${id}-subject`} className="w-full">
              <SelectValue>{ALERT_DOLLAR_LABELS[subject]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {ALERT_DOLLARS.map((each) => (
                <SelectItem key={each} value={each}>
                  {ALERT_DOLLAR_LABELS[each]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
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
          <Label htmlFor={`${id}-figure`}>Precio en $</Label>
          <Input
            id={`${id}-figure`}
            inputMode="decimal"
            autoComplete="off"
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
