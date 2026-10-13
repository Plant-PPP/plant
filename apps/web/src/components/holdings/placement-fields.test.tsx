import { holdingSchema, type Placement } from "@plant/core";
import { renderToStaticMarkup } from "react-dom/server";

import { PlacementFigures, PlacementKindSelect } from "./placement-fields";

const placement = (fields: Record<string, unknown> = {}) =>
  holdingSchema.parse({
    id: "h1",
    portfolio_id: "p1",
    asset_class: "fixed_term",
    instrument_symbol: null,
    amount: "1000000",
    currency: "ARS",
    annual_rate: "0.35",
    started_on: "2026-09-01",
    matures_on: "2026-10-01",
    valued_on: null,
    label: null,
    ...fields,
  }) as Placement;

it("shows the interest to today, at maturity, and the nominal and effective rates", () => {
  const html = renderToStaticMarkup(
    <PlacementFigures placement={placement()} today="2026-09-13" />,
  );
  expect(html).toContain("Interés a hoy");
  expect(html).toContain("$ 11.506,85");
  expect(html).toContain("$ 1.028.767,12 ($ 28.767,12 de interés)");
  expect(html).toContain("35,0 % · 41,2 %");
});

it("says the interest was paid once it matured, and names the one it renewed", () => {
  const html = renderToStaticMarkup(
    <PlacementFigures
      placement={placement()}
      today="2026-10-12"
      renewed={placement({
        started_on: "2026-08-01",
        matures_on: "2026-09-01",
      })}
    />,
  );
  expect(html).toContain("Interés cobrado");
  expect(html).toContain("La del 01/08/2026 al 01/09/2026, de $ 1.000.000,00");
});

it("labels the kind's select and shows the chosen kind", () => {
  const html = renderToStaticMarkup(
    <PlacementKindSelect id="k" value="caucion" onChange={() => {}} />,
  );
  expect(html).toMatch(/<label[^>]*for="k"[^>]*>Tipo de colocación</);
  expect(html).toContain("Caución");
});
