// The chart as it is once drawing it failed.
jest.mock("react", () => ({
  ...jest.requireActual("react"),
  useState: () => [true, () => undefined],
}));

import { renderToStaticMarkup } from "react-dom/server";

import { VegaChart } from "./vega-chart";

it("names the chart by the failure once it could not be drawn", () => {
  const html = renderToStaticMarkup(
    <VegaChart
      spec={{ data: { values: [] }, mark: "bar" }}
      label="Por moneda"
    />,
  );
  expect(html).toContain('aria-label="No pudimos mostrar este gráfico."');
  expect(html).not.toContain('aria-label="Por moneda"');
});
