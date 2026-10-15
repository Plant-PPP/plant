"use client";

import { Bell } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";

import {
  ALERT_REFUSED,
  INVALID_PERCENT,
  INVALID_PRICE,
} from "@/components/settings/alerts-card";
import { AppDialog } from "@/components/ui/app-dialog";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { IconButton } from "@/components/ui/icon-button";
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
  type AlertWriteResult,
  instrumentAlert,
  type NewAlert,
} from "@/lib/alerts/alerts";
import { currencySymbol, parseAmountInput } from "@/lib/format/amount";
import { settle } from "@/lib/server-action-call";

type Kind = "price" | "gain";

const KIND_LABELS: Record<Kind, string> = {
  price: "Precio",
  gain: "Ganancia sobre tu costo",
};
const DIRECTION_LABELS = {
  price: { above: "Sube a", below: "Baja a" },
  gain: { above: "Gana", below: "Pierde" },
} as const;

// The bell on an instrument's page: an alert on its price, or, for one the
// user holds, on its gain or loss over their average cost.
export function InstrumentAlert({
  symbol,
  currency,
  held,
  onCreate,
}: {
  symbol: string;
  currency: "ARS" | "USD";
  held: boolean;
  onCreate: (alert: NewAlert) => Promise<AlertWriteResult>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton
        icon={Bell}
        actionId="alert"
        tooltip="Crear una alerta"
        label={`Crear una alerta de ${symbol}`}
        onClick={() => setOpen(true)}
      />
      {open && (
        <AppDialog
          title={`Alerta de ${symbol}`}
          description="Te avisamos en el Resumen cuando llegue al precio que elijas. Tus alertas están en Ajustes, donde podés borrarlas."
          onClose={() => setOpen(false)}
        >
          <AlertForm
            symbol={symbol}
            currency={currency}
            held={held}
            onCreate={onCreate}
            onDone={() => setOpen(false)}
          />
        </AppDialog>
      )}
    </>
  );
}

function AlertForm({
  symbol,
  currency,
  held,
  onCreate,
  onDone,
}: {
  symbol: string;
  currency: "ARS" | "USD";
  held: boolean;
  onCreate: (alert: NewAlert) => Promise<AlertWriteResult>;
  onDone: () => void;
}) {
  const id = useId();
  const [kind, setKind] = useState<Kind>("price");
  const [direction, setDirection] = useState<"above" | "below">("above");
  const [figure, setFigure] = useState("");
  const [alert, setAlert] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const directions = DIRECTION_LABELS[kind];

  const submit = async () => {
    const input = instrumentAlert(
      kind,
      { symbol, currency },
      direction,
      parseAmountInput(figure),
    );
    if (input === null) {
      return setAlert(kind === "gain" ? INVALID_PERCENT : INVALID_PRICE);
    }
    setAlert(null);
    setBusy(true);
    const settled = await settle(onCreate(input));
    setBusy(false);
    const result = settled === "rejected" ? "failed" : settled;
    if (result !== "ok") return setAlert(ALERT_REFUSED[result]);
    toast.success("Creaste la alerta.");
    onDone();
  };

  return (
    <form
      className="grid gap-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {held && (
        <div className="grid gap-2">
          <Label htmlFor={`${id}-kind`}>Qué mirar</Label>
          <Select
            value={kind}
            onValueChange={(value) => setKind(value as Kind)}
          >
            <SelectTrigger id={`${id}-kind`} className="w-full">
              <SelectValue>{KIND_LABELS[kind]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="price">{KIND_LABELS.price}</SelectItem>
              <SelectItem value="gain">{KIND_LABELS.gain}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
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
            {kind === "gain"
              ? "Porcentaje"
              : `Precio en ${currencySymbol(currency)}`}
          </Label>
          <Input
            id={`${id}-figure`}
            inputMode="decimal"
            autoComplete="off"
            placeholder={kind === "gain" ? "20" : undefined}
            aria-invalid={alert !== null || undefined}
            value={figure}
            onChange={(event) => setFigure(event.target.value)}
          />
        </div>
      </div>
      <p className="text-muted-foreground text-xs">
        Miramos las cotizaciones cada hora desde el cierre del mercado; sin
        cotización automática, usamos el último precio que cargues a mano.
      </p>
      {alert && <FormAlert>{alert}</FormAlert>}
      <Button type="submit" className="justify-self-end" disabled={busy}>
        Crear alerta
      </Button>
    </form>
  );
}
