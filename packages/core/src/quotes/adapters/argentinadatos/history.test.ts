import { parseDollarHistory, readDollarHistory } from "./history";

// Made up, in ArgentinaDatos' shape.
const SERIES = [
  { casa: "bolsa", compra: 1180.5, venta: 1190.25, fecha: "2026-07-01" },
  { casa: "bolsa", compra: 1200, venta: 1195, fecha: "2026-07-02" },
  { casa: "bolsa", compra: null, venta: 1201, fecha: "2026-07-03" },
  { casa: "bolsa", compra: 1100, venta: null, fecha: "2026-07-04" },
  { casa: "bolsa", compra: 1210, venta: 1220, fecha: "2026-10-19" },
];

it("keeps each day before today with a selling rate, dropping a buy above the sell", () => {
  expect(parseDollarHistory(SERIES, "mep", "2026-10-19")).toEqual([
    { kind: "mep", rate_date: "2026-07-01", buy: "1180.5", sell: "1190.25" },
    { kind: "mep", rate_date: "2026-07-02", buy: null, sell: "1195" },
    { kind: "mep", rate_date: "2026-07-03", buy: null, sell: "1201" },
  ]);
});

it("refuses an answer that is not a series", () => {
  expect(() =>
    parseDollarHistory({ error: "x" }, "mep", "2026-10-19"),
  ).toThrow();
});

it("reads the official, MEP and CCL houses up to yesterday in Buenos Aires", async () => {
  const asked: string[] = [];
  const rows = await readDollarHistory(async (url) => {
    asked.push(url);
    return SERIES.slice(0, 1);
  }, new Date("2026-10-19T12:00:00Z"));
  expect(asked.map((url) => url.split("/").pop())).toEqual([
    "oficial",
    "bolsa",
    "contadoconliqui",
  ]);
  expect(rows.map(({ kind }) => kind)).toEqual(["official", "mep", "ccl"]);
});
