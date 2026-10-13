import { renderToStaticMarkup } from "react-dom/server";

import { RatesCard } from "./rates-card";

const ok = async () => ({ ok: true });

it("shows each dollar rate, and marks and reverts the one stated by hand", () => {
  const html = renderToStaticMarkup(
    <RatesCard
      rates={[
        { kind: "mep", sell: "1250", date: "2026-10-12", manual: true },
        { kind: "ccl", sell: "1300.5", date: "2026-10-11", manual: false },
        { kind: "official", sell: null, date: null, manual: false },
      ]}
      today="2026-10-12"
      onSet={ok}
      onRevert={ok}
    />,
  );
  expect(html).toContain("$ 1.250,00 · corregido a mano el 12/10/2026");
  expect(html).toContain("$ 1.300,50 · del 11/10/2026");
  expect(html).toContain("Sin cotización");
  expect(html.match(/Volver a la cotización/g)).toHaveLength(1);
  expect(html).toContain('aria-label="Corregir el Dólar oficial"');
});
