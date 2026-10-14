import type { Denominator } from "@plant/core";

import { InfoPopover } from "@/components/ui/info-popover";

// The BCRA's restriction between the official dollar and MEP, one click away
// beside every unit select that values in MEP dollars.
export function MepInfo({ unit }: { unit: Denominator }) {
  if (unit !== "usd_mep") return null;
  return (
    <InfoPopover label="Restricción del BCRA sobre el dólar MEP">
      Por la Com. A 8336 del BCRA, si comprás dólar oficial no podés operar
      dólar MEP ni CCL durante 90 días, y al revés.
    </InfoPopover>
  );
}
