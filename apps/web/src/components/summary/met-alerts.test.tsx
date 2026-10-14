import { renderToStaticMarkup } from "react-dom/server";

import { alertLine, type PriceAlert } from "@/lib/alerts/alerts";

import { MetAlerts } from "./met-alerts";

const met = (id: string, threshold: string): PriceAlert => ({
  id,
  subjectKind: "dollar",
  subject: "mep",
  direction: "above",
  threshold,
  currency: "ARS",
  gainPercent: null,
  costPrice: null,
  metOn: "2026-10-14",
  metPrice: threshold,
  seenAt: null,
});

it("names each Listo button by its alert", () => {
  const alerts = [met("a1", "1500"), met("a2", "1600")];
  const html = renderToStaticMarkup(
    <MetAlerts alerts={alerts} onSeen={async () => true} />,
  );
  for (const alert of alerts) {
    expect(html).toContain(`aria-label="Listo: ${alertLine(alert)}"`);
  }
});
