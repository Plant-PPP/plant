import { createArgentinadatosFeed, parse } from "./feed";

// 2026-10-09 10:00 in Buenos Aires.
const NOW = new Date("2026-10-09T13:00:00.000Z");

// Invented values in the shape of /v1/finanzas/indices/uva.
const SERIES = [
  { fecha: "2026-10-07", valor: 1601.11 },
  { fecha: "2026-10-09", valor: 1603.33 },
  { fecha: "2026-10-08", valor: 1602.22 },
  { fecha: "2026-10-10", valor: 1604.44 },
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

  it("returns the latest past entry when the series lags", () => {
    const rows = parse(SERIES.slice(0, 1), NOW);
    expect(rows.fxRates[0]?.rate_date).toBe("2026-10-07");
  });

  it("returns no row when every entry is in the future", () => {
    expect(parse(SERIES.slice(3), NOW)).toEqual({ fxRates: [], prices: [] });
  });

  it.each([
    ["a date with a time", [{ fecha: "2026-10-09T00:00:00Z", valor: 1 }]],
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
