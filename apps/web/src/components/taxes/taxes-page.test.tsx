jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

import { renderToStaticMarkup } from "react-dom/server";

import type { AssetKey } from "@/lib/holdings/assets-rows";
import type { TaxReport } from "@/lib/taxes/report";

import { TaxesPage } from "./taxes-page";

const REPORT: TaxReport = {
  year: "2025",
  date: "2025-12-31",
  provisional: false,
  officialBuy: { buy: "1000", date: "2025-12-30" },
  euroBuy: null,
  wealth: {
    lines: [
      {
        key: "instrument:AL30" as AssetKey,
        name: "AL30 · Bonar 2030",
        holdingClass: "bond",
        currency: "ARS",
        amount: "6000",
        ars: "6000",
        exempt: true,
      },
    ],
    taxable: "0",
    exempt: "6000",
    complete: true,
  },
  gains: {
    groups: [{ kind: "sale_cedear", count: 1, amount: "25000" }],
    total: "25000",
    complete: true,
  },
  leftOut: 2,
};

const render = (report: TaxReport, prototype = true) =>
  renderToStaticMarkup(
    <TaxesPage
      report={report}
      years={["2026", "2025"]}
      defaultYear="2025"
      placementKinds={prototype}
      assetExclusion={prototype}
    />,
  );

it("tells the real app's limits: placements as plazo fijo, accounts only", () => {
  const real = render(REPORT, false);
  expect(real).toContain("Toda colocación a tasa cuenta como plazo fijo");
  expect(real).toContain("Lo cambiás en la cuenta.");
  expect(real).not.toContain("en el activo");
  const prototype = render(REPORT);
  expect(prototype).not.toContain("Toda colocación a tasa");
  expect(prototype).toContain("Lo cambiás en la cuenta o en el activo.");
});

it("says it is an estimate and shows both reports in pesos", () => {
  const html = render(REPORT);
  expect(html).toContain("no asesoramiento impositivo");
  expect(html).toContain("Bienes Personales");
  expect(html).toContain("$ 6.000,00");
  expect(html).toContain("Venta de CEDEARs");
  expect(html).toContain("+$ 25.000,00");
  expect(html).toContain("Dejaste 2 activos fuera del reporte impositivo.");
  // The year it opens on has no ?year=.
  expect(html).toMatch(/role="tab" aria-selected="false"[^>]*>2026</);
  expect(html).toMatch(/role="tab" aria-selected="true"[^>]*>2025</);
});

it("says when the year is still running or a figure is missing", () => {
  const html = render({
    ...REPORT,
    year: "2026",
    provisional: true,
    gains: { ...REPORT.gains, complete: false },
  });
  expect(html).toContain("2026 está en curso");
  expect(html).toContain("Faltó algún dato");
});
