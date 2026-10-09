import {
  checkBatch,
  QUOTE_FEED_CODES,
  type QuoteFeedCode,
  QuoteFeedError,
} from "../../contract/quote";
import { createDolarapiFeed, parse } from "./feed";

// 2026-10-09 18:30 in Buenos Aires.
const NOW = new Date("2026-10-09T21:30:00.000Z");

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

  it("reads a stamp with a Buenos Aires offset", () => {
    const local = {
      ...body("blue", 1, 2),
      fechaActualizacion: "2026-10-09T23:30:00-03:00",
    };
    expect(parse(local, "blue").rate_date).toBe("2026-10-09");
  });

  it.each([
    ["a zero buying rate", body("bolsa", 0, 1450)],
    ["a float with noise", body("bolsa", 0.1 + 0.2, 1450)],
    ["a tiny rate printed as an exponent", body("bolsa", 1e-7, 1450)],
  ])("maps %s to a row the schemas count as invalid", (_label, json) => {
    const batch = checkBatch(
      { fxRates: [parse(json, "mep")], prices: [] },
      NOW,
      "dolarapi",
    );
    expect([batch.fxRates.length, batch.refused.invalid]).toEqual([0, ["mep"]]);
  });

  it.each([
    ["0000-10-09T20:00:00Z", 0, 1],
    ["9999-10-09T20:00:00Z", 1, 0],
  ])(
    "maps a rate stamped %s to a dropped row, stale %i and invalid %i",
    (fechaActualizacion, stale, invalid) => {
      const row = parse({ ...body("bolsa", 1, 2), fechaActualizacion }, "mep");
      const batch = checkBatch({ fxRates: [row], prices: [] }, NOW, "dolarapi");
      expect([
        batch.fxRates.length,
        batch.refused.stale.length,
        batch.refused.invalid.length,
      ]).toEqual([0, stale, invalid]);
    },
  );

  it.each([
    ["a string price", { ...body("blue", 1, 2), venta: "2" }],
    ["a null buying rate", { ...body("blue", 1, 2), compra: null }],
    ["no stamp", { compra: 1, venta: 2 }],
    [
      "a day that does not exist",
      { ...body("blue", 1, 2), fechaActualizacion: "2026-02-30T12:00:00Z" },
    ],
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
    const rows = await feed.readRaw(NOW);
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

  it("requests the four houses at once", async () => {
    const answers: (() => void)[] = [];
    const feed = createDolarapiFeed(
      () =>
        new Promise((resolve) => {
          answers.push(() => resolve(body("x", 1, 2)));
        }),
    );
    const read = feed.readRaw(NOW);
    expect(answers).toHaveLength(4);
    answers.forEach((answer) => answer());
    await read;
  });

  it("keeps the other houses when one changed shape", async () => {
    const feed = createDolarapiFeed(async (url) =>
      url.endsWith("/blue")
        ? { ...body("blue", 1, 2), compra: null }
        : body("x", 1, 2),
    );
    const batch = checkBatch(await feed.readRaw(NOW), NOW, "dolarapi");
    expect(batch.fxRates.map((row) => row.kind)).toEqual([
      "official",
      "mep",
      "ccl",
    ]);
    expect(batch.refused.invalid).toEqual(["blue"]);
  });

  const failing =
    (failures: Record<string, QuoteFeedCode>) => async (url: string) => {
      const house = url.split("/").pop() ?? "";
      const code = failures[house];
      if (code) throw new QuoteFeedError(code);
      return body(house, 1, 2);
    };

  it.each(Object.keys(QUOTE_FEED_CODES) as QuoteFeedCode[])(
    "keeps the other houses when one fails with %s",
    async (code) => {
      const feed = createDolarapiFeed(failing({ blue: code }));
      const rows = await feed.readRaw(NOW);
      expect(rows.fxRates.map((row) => row.kind)).toEqual([
        "official",
        "mep",
        "ccl",
      ]);
      expect(rows.unread).toEqual([{ key: "blue", code }]);
      const batch = checkBatch(rows, NOW, "dolarapi");
      expect([batch.fxRates.length, batch.refused.invalid]).toEqual([
        3,
        ["blue"],
      ]);
      expect(batch.unread).toEqual([`blue:${code}`]);
    },
  );

  it("keeps the one house that answered", async () => {
    const feed = createDolarapiFeed(
      failing({ oficial: "http_4xx", bolsa: "http_4xx", blue: "http_4xx" }),
    );
    const batch = checkBatch(await feed.readRaw(NOW), NOW, "dolarapi");
    expect(batch.fxRates.map((row) => row.kind)).toEqual(["ccl"]);
    expect(batch.refused.invalid).toEqual(["official", "mep", "blue"]);
  });

  it("lists each unread house with its code", async () => {
    const feed = createDolarapiFeed(
      failing({ contadoconliqui: "http_4xx", blue: "http_5xx" }),
    );
    const batch = checkBatch(await feed.readRaw(NOW), NOW, "dolarapi");
    expect(batch.unread).toEqual(["ccl:http_4xx", "blue:http_5xx"]);
  });

  it.each([
    ["http_4xx", "http_4xx", false],
    ["http_5xx", "http_5xx", true],
  ] as const)(
    "fails the read when every house fails with %s",
    async (failure, code, retryable) => {
      const feed = createDolarapiFeed(async () => {
        throw new QuoteFeedError(failure);
      });
      await expect(feed.readRaw(NOW)).rejects.toMatchObject({
        code,
        retryable,
      });
    },
  );

  it("fails with a retryable error when every house fails and one may pass on a retry", async () => {
    const feed = createDolarapiFeed(
      failing({
        oficial: "http_4xx",
        bolsa: "bad_json",
        contadoconliqui: "timeout",
        blue: "http_5xx",
      }),
    );
    await expect(feed.readRaw(NOW)).rejects.toMatchObject({
      code: "timeout",
      retryable: true,
    });
  });

  it("passes an error that is not a QuoteFeedError through unchanged", async () => {
    const bug = new TypeError("boom");
    const feed = createDolarapiFeed(async (url) => {
      if (url.endsWith("/blue")) throw bug;
      return body("x", 1, 2);
    });
    await expect(feed.readRaw(NOW)).rejects.toBe(bug);
  });
});
