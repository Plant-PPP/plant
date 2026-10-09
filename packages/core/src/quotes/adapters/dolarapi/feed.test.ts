import { checkBatch, QuoteFeedError } from "../../contract/quote";
import { toQuoteFeed } from "../../factory";
import { createDolarapiFeed, parse } from "./feed";

describe("dolarapi parse edges", () => {
  const NOW = new Date("2026-10-09T21:30:00.000Z");
  const house = (compra: number, venta: number) => ({
    compra,
    venta,
    fechaActualizacion: "2026-10-09T20:57:00.000Z",
  });

  it.each([
    ["a zero buying rate", house(0, 1450)],
    ["a float with noise", house(0.1 + 0.2, 1450)],
    ["a tiny rate printed as an exponent", house(1e-7, 1450)],
  ])("maps %s to a row the schemas count as invalid", (_label, json) => {
    const row = parse(json, "mep");
    const batch = checkBatch({ fxRates: [row], prices: [] }, NOW);
    expect([batch.fxRates.length, batch.invalidCount]).toEqual([0, 1]);
  });

  it("throws bad_shape on a null buying rate", () => {
    expect(() => parse({ ...house(1, 2), compra: null }, "official")).toThrow(
      expect.objectContaining({ code: "bad_shape" }),
    );
  });
});

// Invented values in the shape of /v1/dolares/{house}.
const body = (casa: string, compra: number, venta: number) => ({
  moneda: "USD",
  casa,
  nombre: casa,
  compra,
  venta,
  fechaActualizacion: "2026-10-09T20:57:00.000Z",
});

describe("dolarapi parse", () => {
  it("maps a house to a rate dated by its stamp in Buenos Aires", () => {
    expect(parse(body("bolsa", 1401.2, 1415.9), "mep")).toEqual({
      kind: "mep",
      rate_date: "2026-10-09",
      buy: "1401.2",
      sell: "1415.9",
      source: "dolarapi",
      quoted_at: "2026-10-09T20:57:00.000Z",
    });
  });

  it("dates a late-evening stamp by the Buenos Aires day", () => {
    const late = {
      ...body("blue", 1, 2),
      fechaActualizacion: "2026-10-10T01:00:00.000Z",
    };
    expect(parse(late, "blue").rate_date).toBe("2026-10-09");
  });

  it.each([
    ["a string price", { ...body("blue", 1, 2), venta: "2" }],
    ["no stamp", { compra: 1, venta: 2 }],
    ["a list", [body("blue", 1, 2)]],
  ])("throws bad_shape on %s", (_label, json) => {
    expect(() => parse(json, "blue")).toThrow(
      expect.objectContaining({ code: "bad_shape", retryable: false }),
    );
  });
});

describe("createDolarapiFeed", () => {
  it("reads the four houses from their own endpoints", async () => {
    const urls: string[] = [];
    const feed = createDolarapiFeed(async (url) => {
      urls.push(url);
      return body(url.split("/").pop() ?? "", 1, 2);
    });
    const rows = await feed.readRaw(new Date());
    expect(feed.id).toBe("dolarapi");
    expect(urls).toEqual([
      "https://dolarapi.com/v1/dolares/oficial",
      "https://dolarapi.com/v1/dolares/bolsa",
      "https://dolarapi.com/v1/dolares/contadoconliqui",
      "https://dolarapi.com/v1/dolares/blue",
    ]);
    expect(rows.fxRates.map((row) => row.kind)).toEqual([
      "official",
      "mep",
      "ccl",
      "blue",
    ]);
    expect(rows.prices).toEqual([]);
  });

  it("fails the read when one house fails", async () => {
    const feed = createDolarapiFeed(async (url) => {
      if (url.endsWith("/blue")) throw new QuoteFeedError("http_5xx", true);
      return body("x", 1, 2);
    });
    await expect(feed.readRaw(new Date())).rejects.toMatchObject({
      code: "http_5xx",
    });
  });
});

describe("dolarapi on a hostile answer", () => {
  // 2026-10-09 18:30 in Buenos Aires.
  const NOW = new Date("2026-10-09T21:30:00.000Z");
  const stamped = (fechaActualizacion: string) =>
    toQuoteFeed(
      createDolarapiFeed(async () => ({
        ...body("bolsa", 1, 2),
        fechaActualizacion,
      })),
    ).read(NOW);

  // Today in Buenos Aires, but an offset Postgres refuses (beyond ±15:59).
  it("hands the store a quoted_at Postgres accepts", async () => {
    const batch = await stamped("2026-10-10T17:00:00+23:59");
    for (const row of batch.fxRates) {
      expect(row.quoted_at).not.toMatch(/[+-](1[6-9]|2\d):\d\d$/);
    }
  });

  it.each(["0000-10-09T20:00:00Z", "9999-10-09T20:00:00Z"])(
    "drops a rate stamped %s",
    async (stamp) => {
      const batch = await stamped(stamp);
      expect([
        batch.fxRates.length,
        batch.staleCount + batch.invalidCount,
      ]).toEqual([0, 4]);
    },
  );

  it("refuses a stamp on a day that does not exist", () => {
    expect(() =>
      parse(
        { ...body("bolsa", 1, 2), fechaActualizacion: "2026-02-30T12:00:00Z" },
        "mep",
      ),
    ).toThrow(expect.objectContaining({ code: "bad_shape" }));
  });
});
