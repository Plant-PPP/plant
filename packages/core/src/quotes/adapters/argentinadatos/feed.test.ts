import { createArgentinadatosFeed, parse } from "./feed";

// 2026-10-09 10:00 in Buenos Aires.
const NOW = new Date("2026-10-09T13:00:00.000Z");

// Invented values in the shape of /v1/finanzas/indices/uva.
const SERIES = [
  { fecha: "2026-10-07", valor: 1601.11 },
  { fecha: "2026-10-09", valor: 1603.33 },
  { fecha: "2026-10-08", valor: 1602.22 },
  { fecha: "2026-10-10", valor: 1604.44 },
  { fecha: "9999-12-31", valor: 1 },
];

describe("argentinadatos parse", () => {
  it("keeps today's entry, dated as written, and ignores later ones", () => {
    expect(parse(SERIES, NOW)).toEqual({
      fxRates: [
        {
          kind: "uva",
          rate_date: "2026-10-09",
          buy: null,
          sell: "1603.33",
          source: "argentinadatos",
          quoted_at: "2026-10-09T03:00:00.000Z",
        },
      ],
      prices: [],
    });
  });

  it("keeps the last of two entries for today", () => {
    const rows = parse(
      [
        { fecha: "2026-10-09", valor: 1 },
        { fecha: "2026-10-09", valor: 2 },
      ],
      NOW,
    );
    expect(rows.fxRates.map((row) => row.sell)).toEqual(["2"]);
  });

  it("returns the latest past entry when the series lags", () => {
    const rows = parse(SERIES.slice(0, 1), NOW);
    expect(rows.fxRates[0]?.rate_date).toBe("2026-10-07");
  });

  it.each([
    ["every entry is in the future", SERIES.slice(3)],
    ["the series is empty", []],
  ])("returns no row when %s", (_label, json) => {
    expect(parse(json, NOW)).toEqual({ fxRates: [], prices: [] });
  });

  it("leaves an exponent valor for the schemas to refuse", () => {
    const rows = parse([{ fecha: "2026-10-09", valor: 1e-7 }], NOW);
    expect(rows.fxRates[0]?.sell).toBe("1e-7");
  });

  it("reads a series of 200 000 entries", () => {
    const series = Array.from({ length: 200_000 }, (_, i) => ({
      fecha: "2000-01-01",
      valor: i + 1,
    }));
    expect(parse(series, NOW).fxRates[0]?.sell).toBe("200000");
  });

  it.each([
    ["a date with a time", [{ fecha: "2026-10-09T00:00:00Z", valor: 1 }]],
    ["a day that does not exist", [{ fecha: "2026-02-30", valor: 1 }]],
    ["a string value", [{ fecha: "2026-10-09", valor: "1" }]],
    ["an object", { fecha: "2026-10-09", valor: 1 }],
  ])("throws bad_shape on %s", (_label, json) => {
    expect(() => parse(json, NOW)).toThrow(
      expect.objectContaining({ code: "bad_shape", retryable: false }),
    );
  });
});

describe("createArgentinadatosFeed", () => {
  it("reads the UVA series", async () => {
    const urls: string[] = [];
    const feed = createArgentinadatosFeed(async (url) => {
      urls.push(url);
      return SERIES;
    });
    await feed.readRaw(NOW);
    expect(feed.id).toBe("argentinadatos");
    expect(urls).toEqual([
      "https://api.argentinadatos.com/v1/finanzas/indices/uva",
    ]);
  });
});
