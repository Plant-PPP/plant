import { renderToStaticMarkup } from "react-dom/server";

import { barsOf } from "@/lib/assistant/chat";

import { ChartBoundary, ChartCard } from "./chart-card";

const chart = barsOf("debts", "Lo que debés", "ars", [
  { label: "Hipoteca", value: "1000" },
]);

it("shows the title, the day and unit of the data, and its actions", () => {
  const html = renderToStaticMarkup(
    <ChartCard chart={chart} asOf="2026-10-12" />,
  );
  expect(html).toContain("Lo que debés");
  expect(html).toContain("Datos al 12/10/2026 en Pesos");
  for (const action of ["Ampliar", "Descargar CSV", "Descargar imagen"]) {
    expect(html).toContain(`aria-label="${action}: Lo que debés"`);
  }
  expect(html).toContain("Hipoteca");
});

it("draws a line as a chart named by its title, and every value for a screen reader", () => {
  const html = renderToStaticMarkup(
    <ChartCard
      chart={{
        kind: "line",
        title: "Tu patrimonio",
        unit: "ars",
        points: [
          { label: "Ene 26", value: "100" },
          { label: "Feb 26", value: "150" },
          { label: "Mar 26", value: "120" },
        ],
      }}
      asOf="2026-10-12"
    />,
  );
  expect(html).toContain('role="img" aria-label="Tu patrimonio"');
  expect(html).toContain("Ene 26: $ 100,00");
  expect(html).toContain("Feb 26: $ 150,00");
  expect(html).toContain("Mar 26: $ 120,00");
});

it("says a chart that failed to draw could not be shown", () => {
  const boundary = new ChartBoundary({ children: "chart" });
  boundary.state = ChartBoundary.getDerivedStateFromError();
  expect(renderToStaticMarkup(boundary.render())).toContain(
    "No pudimos mostrar este gráfico.",
  );
});
