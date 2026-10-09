import { QuoteFeedError } from "../../contract/quote";
import { createDolarapiFeed, parse } from "./feed";

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
