import { barsOf, type ChartPart } from "./chat";
import {
  barShare,
  chartCaption,
  chartCsv,
  chartFileName,
  drawChart,
  largest,
  linePoints,
} from "./chart-files";

const bars = barsOf("Resultado por mes de 2026", "usd_mep", [
  { label: "Ene", value: "10" },
  { label: "Feb", value: "-40" },
  { label: "Mar, abr", value: "20" },
]);
const line: ChartPart = { ...bars, kind: "line", title: "Tu patrimonio" };

it("names the day and unit of the data", () => {
  expect(chartCaption(bars, "2026-10-12")).toBe(
    "Datos al 12/10/2026 en Dólar MEP",
  );
});

it("saves the points as a CSV under a name from the title", () => {
  expect(chartCsv(bars)).toBe(
    'Concepto,Valor (Dólar MEP)\r\nEne,10\r\nFeb,-40\r\n"Mar, abr",20',
  );
  expect(chartFileName(bars, "csv")).toBe("resultado-por-mes-de-2026.csv");
  expect(chartFileName({ ...bars, title: "¿?" }, "png")).toBe("grafico.png");
});

it("scales bars to the largest magnitude", () => {
  expect(largest(bars)).toBe("40");
  expect(barShare("-40", "40")).toBe(1);
  expect(barShare("10", "40")).toBe(0.25);
  expect(barShare("10", "0")).toBe(0);
});

it("places a line's points from left to right, the highest on top", () => {
  expect(linePoints(line, 100, 60)).toEqual([
    { x: 0, y: 10 },
    { x: 50, y: 60 },
    { x: 100, y: 0 },
  ]);
  expect(
    linePoints({ ...line, points: [{ label: "Ene", value: "5" }] }, 100, 60),
  ).toEqual([{ x: 50, y: 30 }]);
});

it("draws the title, each label and value, and the caption", () => {
  const texts: string[] = [];
  const context = new Proxy(
    {},
    {
      get: (_, key) =>
        key === "fillText"
          ? (text: string) => texts.push(text)
          : () => undefined,
      set: () => true,
    },
  ) as CanvasRenderingContext2D;
  drawChart(context, bars, "Datos al 12/10/2026 en Dólar MEP");
  expect(texts).toEqual(
    expect.arrayContaining([
      "Resultado por mes de 2026",
      "Datos al 12/10/2026 en Dólar MEP",
      "Feb",
      "-US$ 40,00",
    ]),
  );
  texts.length = 0;
  drawChart(context, line, "caption");
  expect(texts).toEqual(
    expect.arrayContaining(["Ene", "Mar, abr", "US$ 10,00", "US$ 20,00"]),
  );
});
