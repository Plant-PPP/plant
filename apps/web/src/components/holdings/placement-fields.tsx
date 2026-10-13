import { type Placement, placementFigures } from "@plant/core";

import { choose } from "@/components/portfolio-setup/field-alert";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatAmount, formatFraction } from "@/lib/format/amount";
import { formatDate } from "@/lib/format/date";
import {
  PLACEMENT_KINDS,
  PLACEMENT_KIND_LABELS,
  type PlacementKind,
} from "@/lib/holdings/placement";

// What a placement at a rate is: plazo fijo, caución, loan given or other.
export function PlacementKindSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: PlacementKind;
  onChange: (kind: PlacementKind) => void;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>Tipo de colocación</Label>
      <Select
        value={value}
        onValueChange={choose((next) => onChange(next as PlacementKind))}
      >
        <SelectTrigger id={id} className="w-full">
          {/* The chosen kind, so the server render shows it too. */}
          <SelectValue>{PLACEMENT_KIND_LABELS[value]}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {PLACEMENT_KINDS.map((kind) => (
            <SelectItem key={kind} value={kind}>
              {PLACEMENT_KIND_LABELS[kind]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// What a saved placement pays, to today and at its maturity, at its nominal
// and effective rates; and the placement it renewed, if any.
export function PlacementFigures({
  placement,
  today,
  renewed,
}: {
  placement: Placement;
  today: string;
  renewed?: Placement;
}) {
  const figures = placementFigures(placement, today);
  const money = (amount: string) => formatAmount(amount, placement.currency);
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border p-3 text-sm">
      <dt className="text-muted-foreground">
        {today < placement.matures_on ? "Interés a hoy" : "Interés cobrado"}
      </dt>
      <dd className="tabular-nums">{money(figures.accrued)}</dd>
      <dt className="text-muted-foreground">Al vencimiento</dt>
      <dd className="tabular-nums">
        {`${money(figures.maturityAmount)} (${money(figures.atMaturity)} de interés)`}
      </dd>
      <dt className="text-muted-foreground">TNA y TEA</dt>
      <dd className="tabular-nums">
        {figures.effectiveRate === null
          ? formatFraction(placement.annual_rate)
          : `${formatFraction(placement.annual_rate)} · ${formatFraction(figures.effectiveRate)}`}
      </dd>
      {renewed && (
        <>
          <dt className="text-muted-foreground">Renueva</dt>
          <dd>
            {`La del ${formatDate(renewed.started_on)} al ${formatDate(renewed.matures_on)}, de ${money(renewed.amount)}`}
          </dd>
        </>
      )}
    </dl>
  );
}
