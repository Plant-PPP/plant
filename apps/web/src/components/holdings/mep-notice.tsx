import type { Denominator } from "@plant/core";
import { Info } from "lucide-react";

// The BCRA's restriction between the official dollar and MEP, under every
// view valued in MEP dollars.
export function MepNotice({ unit }: { unit: Denominator }) {
  if (unit !== "usd_mep") return null;
  return (
    <p className="text-muted-foreground flex items-start gap-1.5 text-xs">
      <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      Por la Com. A 8336 del BCRA, si comprás dólar oficial no podés operar
      dólar MEP ni CCL durante 90 días, y al revés.
    </p>
  );
}
