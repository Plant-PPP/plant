import type { GetJson, GetJsonOptions, PostForm } from "../../contract/port";
import { QuoteFeedError } from "../../contract/quote";
import { toQuoteFeed } from "../../factory";
import { createIolFeed, type IolInstrument, parseLine } from "./feed";

// Friday 2026-10-09, 18:30 in Buenos Aires.
const NOW = new Date("2026-10-09T21:30:00.000Z");
const CREDENTIALS = { username: "plant-test", password: "made-up-password" };

// The catalog's CEDEARs and bonds, made up for these tests.
const CATALOG: readonly IolInstrument[] = [
  { symbol: "AAPL", type: "cedear", currency: "ARS" },
  { symbol: "KO", type: "cedear", currency: "ARS" },
  { symbol: "MELI", type: "cedear", currency: "ARS" },
  { symbol: "MSFT", type: "cedear", currency: "ARS" },
  { symbol: "NVDA", type: "cedear", currency: "ARS" },
  { symbol: "SPY", type: "cedear", currency: "ARS" },
  { symbol: "TSLA", type: "cedear", currency: "ARS" },
  { symbol: "AL30", type: "bond", currency: "ARS" },
  { symbol: "GD30", type: "bond", currency: "USD" },
  { symbol: "TX26", type: "bond", currency: "ARS" },
];

const instrument = (symbol: string) => {
  const found = CATALOG.find((each) => each.symbol === symbol);
  if (!found) throw new Error(`no instrument ${symbol}`);
  return found;
};

// Invented values in the shape of /api/v2/Cotizaciones/{panel}/argentina/Todos.
const line = (simbolo: string, ultimoPrecio: number, extra = {}) => ({
  simbolo,
  ultimoPrecio,
  fecha: "2026-10-09T16:59:57.537",
  moneda: "peso_Argentino",
  puntas: null,
  ...extra,
});

const CEDEARS = {
  titulos: [
    line("AAPL", 18250.5),
    line("KO", 21480),
    line("MELI", 25010.25),
    line("MSFT", 19950),
    line("NVDA", 9720.75),
    line("SPY", 41200),
    line("TSLA", 30110),
  ],
};
const BONDS = {
  titulos: [
    line("AL30", 71500.5),
    line("GD30", 84300),
    line("GD30D", 81.2, { moneda: "dolar_Estadounidense" }),
    line("TX26", 1270.1),
  ],
};

const TOKEN = {
  access_token: "made-up-access",
  token_type: "bearer",
  expires_in: 899,
  refresh_token: "made-up-refresh",
  ".issued": "Fri, 09 Oct 2026 21:30:00 GMT",
  ".expires": "Fri, 09 Oct 2026 21:45:00 GMT",
  ".refreshexpires": "Fri, 09 Oct 2026 22:00:00 GMT",
};

type Call = { url: string; options?: GetJsonOptions };

const PANEL_OPTIONS = {
  headers: { Authorization: "Bearer made-up-access" },
  maxBytes: 8 * 1024 * 1024,
};
type Form = Readonly<Record<string, string>>;

function transport(
  options: {
    panel?: (url: string, call: number) => unknown;
    token?: (form: Form, call: number) => unknown;
  } = {},
) {
  const gets: Call[] = [];
  const posts: { url: string; form: Form }[] = [];
  const getJson: GetJson = async (url, sent) => {
    gets.push({ url, options: sent });
    if (options.panel) return options.panel(url, gets.length);
    if (url.includes("/cedears/")) return CEDEARS;
    return url.includes("/titulosPublicos/") ? BONDS : { titulos: [] };
  };
  const postForm: PostForm = async (url, form) => {
    posts.push({ url, form });
    return options.token ? options.token(form, posts.length) : TOKEN;
  };
  return { getJson, postForm, gets, posts };
}

const feedWith = (
  t: ReturnType<typeof transport>,
  catalog: readonly {
    symbol: string;
    type: "crypto" | IolInstrument["type"];
    currency: IolInstrument["currency"];
  }[] = CATALOG,
) =>
  createIolFeed({
    getJson: t.getJson,
    postForm: t.postForm,
    credentials: CREDENTIALS,
    instruments: async () => catalog,
  });

const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);

describe("iol parseLine", () => {
  it("prices a CEDEAR per unit in pesos, dated by its Buenos Aires stamp", () => {
    expect(parseLine(instrument("AAPL"), CEDEARS.titulos, NOW)).toEqual({
      symbol: "AAPL",
      price_date: "2026-10-09",
      price: "18250.5",
      currency: "ARS",
      quoted_at: "2026-10-09T19:59:57.537Z",
    });
  });

  it("turns a bond's price per 100 nominal into a price per unit", () => {
    expect(parseLine(instrument("AL30"), BONDS.titulos, NOW).price).toBe(
      "715.005",
    );
  });

  it("reads a dollar bond from its MEP line", () => {
    expect(parseLine(instrument("GD30"), BONDS.titulos, NOW)).toMatchObject({
      symbol: "GD30",
      price: "0.812",
      currency: "USD",
    });
  });

  it.each([
    ["an unknown moneda", "AAPL", { moneda: "peso" }],
    ["a numeric moneda", "AAPL", { moneda: 1 }],
    ["an unknown moneda on a dollar line", "GD30", { moneda: "usd" }],
    ["no moneda on a dollar line", "GD30", { moneda: undefined }],
    ["a null moneda on a dollar line", "GD30", { moneda: null }],
  ])("refuses a line with %s", (_label, symbol, extra) => {
    const titulos = [line(symbol === "GD30" ? "GD30D" : symbol, 81.2, extra)];
    const row = parseLine(instrument(symbol), titulos, NOW);
    expect([row.price, row.price_date]).toEqual(["", "2026-10-09"]);
  });

  it.each([
    ["no moneda", { moneda: undefined }],
    ["a null moneda", { moneda: null }],
  ])("prices a peso line with %s in pesos", (_label, extra) => {
    const titulos = [line("KO", 21480, extra)];
    expect(parseLine(instrument("KO"), titulos, NOW)).toMatchObject({
      price: "21480",
      currency: "ARS",
    });
  });

  it("refuses a line in the other currency", () => {
    const titulos = [line("GD30D", 81.2, { moneda: "peso_Argentino" })];
    expect(parseLine(instrument("GD30"), titulos, NOW).price).toBe("");
  });

  it("reads a stamp that carries its offset", () => {
    const titulos = [line("KO", 1, { fecha: "2026-10-09T17:00:00-03:00" })];
    expect(parseLine(instrument("KO"), titulos, NOW).quoted_at).toBe(
      "2026-10-09T20:00:00.000Z",
    );
  });

  it("dates a line IOL last quoted another day by that day", () => {
    const titulos = [line("KO", 1, { fecha: "2026-10-08T17:00:00" })];
    expect(parseLine(instrument("KO"), titulos, NOW)).toMatchObject({
      price_date: "2026-10-08",
      price: "1",
    });
  });

  it.each([
    ["missing", []],
    ["with no traded price", [line("KO", 0)]],
    ["with a negative price", [line("KO", -1)]],
    ["with a price in exponent notation", [line("KO", 1e-7)]],
    ["with a string price", [{ ...line("KO", 1), ultimoPrecio: "1" }]],
    ["with no stamp", [{ ...line("KO", 1), fecha: null }]],
    ["with a stamp it cannot read", [line("KO", 1, { fecha: "09/10/2026" })]],
  ])("refuses a line %s", (_label, titulos) => {
    expect(parseLine(instrument("KO"), titulos, NOW).price).toBe("");
  });

  it("refuses a bond price a unit price cannot hold exactly", () => {
    const titulos = [line("AL30", 0.0000001)];
    expect(parseLine(instrument("AL30"), titulos, NOW).price).toBe("");
  });

  it("refuses a price with more decimals than a unit price holds", () => {
    const titulos = [line("KO", 1.123456789)];
    expect(parseLine(instrument("KO"), titulos, NOW).price).toBe("");
  });

  it("does not read a line through a __proto__ key", () => {
    const titulos = [JSON.parse('{"__proto__":{"simbolo":"KO"}}') as unknown];
    expect(parseLine(instrument("KO"), titulos, NOW).price).toBe("");
  });
});

describe("createIolFeed", () => {
  it("asks for a token with the password, then each panel once with it", async () => {
    const t = transport();
    const feed = feedWith(t);
    const rows = await feed.readRaw(NOW);
    expect(feed.id).toBe("iol");
    expect(t.posts).toEqual([
      {
        url: "https://api.invertironline.com/token",
        form: {
          grant_type: "password",
          username: CREDENTIALS.username,
          password: CREDENTIALS.password,
        },
      },
    ]);
    expect(t.gets).toEqual([
      {
        url: "https://api.invertironline.com/api/v2/Cotizaciones/cedears/argentina/Todos?cotizacionInstrumentoModel.instrumento=cedears&cotizacionInstrumentoModel.pais=argentina",
        options: PANEL_OPTIONS,
      },
      {
        url: "https://api.invertironline.com/api/v2/Cotizaciones/titulosPublicos/argentina/Todos?cotizacionInstrumentoModel.instrumento=titulosPublicos&cotizacionInstrumentoModel.pais=argentina",
        options: PANEL_OPTIONS,
      },
      {
        url: "https://api.invertironline.com/api/v2/Cotizaciones/obligacionesNegociables/argentina/Todos?cotizacionInstrumentoModel.instrumento=obligacionesNegociables&cotizacionInstrumentoModel.pais=argentina",
        options: PANEL_OPTIONS,
      },
      {
        url: "https://api.invertironline.com/api/v2/Cotizaciones/letras/argentina/Todos?cotizacionInstrumentoModel.instrumento=letras&cotizacionInstrumentoModel.pais=argentina",
        options: PANEL_OPTIONS,
      },
    ]);
    expect(rows.prices.map((row) => [row.symbol, row.price])).toEqual([
      ["AAPL", "18250.5"],
      ["KO", "21480"],
      ["MELI", "25010.25"],
      ["MSFT", "19950"],
      ["NVDA", "9720.75"],
      ["SPY", "41200"],
      ["TSLA", "30110"],
      ["AL30", "715.005"],
      ["GD30", "0.812"],
      ["TX26", "12.701"],
    ]);
    expect(rows.unread).toEqual([]);
  });

  it("reuses the token while it lives", async () => {
    const t = transport();
    const feed = feedWith(t);
    await feed.readRaw(NOW);
    await feed.readRaw(minutes(10));
    expect(t.posts).toHaveLength(1);
  });

  it("refreshes an expired token with the refresh token", async () => {
    const t = transport();
    const feed = feedWith(t);
    await feed.readRaw(NOW);
    await feed.readRaw(minutes(20));
    expect(t.posts.map(({ form }) => form)).toEqual([
      expect.objectContaining({ grant_type: "password" }),
      { grant_type: "refresh_token", refresh_token: "made-up-refresh" },
    ]);
  });

  it("logs in again when the refresh token expired", async () => {
    const t = transport();
    const feed = feedWith(t);
    await feed.readRaw(NOW);
    await feed.readRaw(minutes(60));
    expect(t.posts.map(({ form }) => form.grant_type)).toEqual([
      "password",
      "password",
    ]);
  });

  it("logs in again when IOL refuses the refresh", async () => {
    const t = transport({
      token: (form) => {
        if (form.grant_type === "refresh_token") {
          throw new QuoteFeedError("http_4xx");
        }
        return TOKEN;
      },
    });
    const feed = feedWith(t);
    await feed.readRaw(NOW);
    await feed.readRaw(minutes(20));
    expect(t.posts.map(({ form }) => form.grant_type)).toEqual([
      "password",
      "refresh_token",
      "password",
    ]);
  });

  it("asks for a new token once when IOL refuses the cached one", async () => {
    let refuse = false;
    const t = transport({
      panel: (url) => {
        if (refuse) {
          refuse = false;
          throw new QuoteFeedError("unauthorized");
        }
        return url.includes("/cedears/") ? CEDEARS : BONDS;
      },
    });
    const feed = feedWith(t);
    await feed.readRaw(NOW);
    refuse = true;
    const rows = await feed.readRaw(minutes(1));
    expect(t.posts).toHaveLength(2);
    expect(rows.unread).toEqual([]);
  });

  it("fails a panel IOL does not find, without logging in again", async () => {
    let missing = false;
    const t = transport({
      panel: (url) => {
        if (missing && url.includes("/cedears/")) {
          throw new QuoteFeedError("http_4xx");
        }
        return url.includes("/cedears/") ? CEDEARS : BONDS;
      },
    });
    const feed = feedWith(t);
    await feed.readRaw(NOW);
    missing = true;
    const rows = await feed.readRaw(minutes(1));
    expect(t.posts).toHaveLength(1);
    expect(t.gets).toHaveLength(8);
    expect(rows.unread).toEqual(
      ["AAPL", "KO", "MELI", "MSFT", "NVDA", "SPY", "TSLA"].map((key) => ({
        key,
        code: "http_4xx",
      })),
    );
  });

  it("lists every instrument of a panel that failed as unread", async () => {
    const t = transport({
      panel: (url) => {
        if (url.includes("/titulosPublicos/")) {
          throw new QuoteFeedError("http_5xx");
        }
        return CEDEARS;
      },
    });
    const rows = await feedWith(t).readRaw(NOW);
    expect(rows.prices).toHaveLength(7);
    expect(rows.unread).toEqual([
      { key: "AL30", code: "http_5xx" },
      { key: "GD30", code: "http_5xx" },
      { key: "TX26", code: "http_5xx" },
    ]);
  });

  it("lists a panel that changed shape as unread", async () => {
    const t = transport({
      panel: (url) => (url.includes("/cedears/") ? CEDEARS : { rows: [] }),
    });
    const rows = await feedWith(t).readRaw(NOW);
    expect(rows.unread?.map(({ code }) => code)).toEqual(
      Array(3).fill("bad_shape"),
    );
  });

  it.each([
    ["a refused login", new QuoteFeedError("http_4xx"), "http_4xx", false],
    ["IOL down", new QuoteFeedError("http_5xx"), "http_5xx", true],
  ])("fails the read on %s", async (_label, error, code, retryable) => {
    const t = transport({
      token: () => {
        throw error;
      },
    });
    await expect(feedWith(t).readRaw(NOW)).rejects.toMatchObject({
      code,
      retryable,
    });
    expect(t.gets).toEqual([]);
  });

  it("fails bad_shape on a token answer with no access token", async () => {
    const t = transport({ token: () => ({ token_type: "bearer" }) });
    await expect(feedWith(t).readRaw(NOW)).rejects.toMatchObject({
      code: "bad_shape",
    });
  });

  it("fails unconfigured, asking IOL nothing, with no credentials", async () => {
    const t = transport();
    const feed = createIolFeed({
      getJson: t.getJson,
      postForm: t.postForm,
      credentials: null,
      instruments: async () => CATALOG,
    });
    await expect(feed.readRaw(NOW)).rejects.toMatchObject({
      name: "QuoteFeedError",
      code: "unconfigured",
      retryable: false,
    });
    expect([t.gets, t.posts]).toEqual([[], []]);
  });

  it("passes any other error through", async () => {
    const bug = new TypeError("boom");
    const t = transport({
      panel: () => {
        throw bug;
      },
    });
    await expect(feedWith(t).readRaw(NOW)).rejects.toBe(bug);
  });

  it("never puts the token or the credentials in a row or an error", async () => {
    const t = transport({
      panel: () => {
        throw new QuoteFeedError("http_5xx");
      },
    });
    const feed = toQuoteFeed(feedWith(t));
    const error = await feed.read(NOW).catch((thrown: unknown) => thrown);
    const visible = JSON.stringify([
      error,
      String(error),
      await feedWith(transport()).readRaw(NOW),
    ]);
    for (const secret of [
      TOKEN.access_token,
      TOKEN.refresh_token,
      CREDENTIALS.username,
      CREDENTIALS.password,
    ]) {
      expect(visible).not.toContain(secret);
    }
  });
});

describe("iol through the factory", () => {
  const read = (now: Date, panel?: (url: string) => unknown) =>
    toQuoteFeed(feedWith(transport({ panel }))).read(now);

  it("keeps today's prices after the close", async () => {
    const batch = await read(NOW);
    expect(batch.prices).toHaveLength(10);
    expect(batch.prices.every((row) => row.source === "iol")).toBe(true);
  });

  it("refuses every price before the close as early", async () => {
    const batch = await read(new Date("2026-10-09T15:00:00.000Z"));
    expect(batch.refused.early).toHaveLength(10);
  });

  it("refuses Friday's prices on the weekend as closed", async () => {
    const batch = await read(new Date("2026-10-10T21:30:00.000Z"));
    expect(batch.refused.closed).toHaveLength(10);
  });

  it("refuses a weekday price IOL last quoted the day before as stale", async () => {
    const yesterday = { fecha: "2026-10-08T17:00:00" };
    const batch = await read(NOW, (url) =>
      url.includes("/cedears/")
        ? {
            titulos: CEDEARS.titulos.map((each) => ({ ...each, ...yesterday })),
          }
        : BONDS,
    );
    expect(batch.refused.stale).toEqual([
      "AAPL",
      "KO",
      "MELI",
      "MSFT",
      "NVDA",
      "SPY",
      "TSLA",
    ]);
  });

  it("fails bad_shape when no instrument is in the answer", async () => {
    await expect(read(NOW, () => ({ titulos: [] }))).rejects.toMatchObject({
      code: "bad_shape",
    });
  });
});

describe("iol over the catalog", () => {
  it("reads only the panels of the catalog's types, skipping the others", async () => {
    const t = transport();
    const rows = await feedWith(t, [
      { symbol: "KO", type: "cedear", currency: "ARS" },
      { symbol: "BTC", type: "crypto", currency: "USD" },
    ]).readRaw(NOW);
    expect(t.gets.map(({ url }) => url.split("/")[6])).toEqual(["cedears"]);
    expect(rows.prices.map(({ symbol }) => symbol)).toEqual(["KO"]);
  });

  it("asks IOL nothing when the catalog has none of its types", async () => {
    const t = transport();
    const rows = await feedWith(t, [
      { symbol: "BTC", type: "crypto", currency: "USD" },
    ]).readRaw(NOW);
    expect(rows).toEqual({ fxRates: [], prices: [] });
    expect([t.gets, t.posts]).toEqual([[], []]);
  });

  it("finds a bond in any of its panels", async () => {
    const t = transport({
      panel: (url) =>
        url.includes("/obligacionesNegociables/")
          ? { titulos: [line("YCA6O", 102.5)] }
          : { titulos: [] },
    });
    const rows = await feedWith(t, [
      { symbol: "YCA6O", type: "bond", currency: "ARS" },
    ]).readRaw(NOW);
    expect(rows.prices.map(({ price }) => price)).toEqual(["1.025"]);
  });

  it("prices a line another panel of its type listed though one failed", async () => {
    const t = transport({
      panel: (url) => {
        if (url.includes("/letras/")) throw new QuoteFeedError("http_5xx");
        return url.includes("/titulosPublicos/") ? BONDS : { titulos: [] };
      },
    });
    const rows = await feedWith(t, [
      { symbol: "AL30", type: "bond", currency: "ARS" },
      { symbol: "S31O6", type: "bond", currency: "ARS" },
    ]).readRaw(NOW);
    expect(rows.prices.map(({ symbol }) => symbol)).toEqual(["AL30"]);
    expect(rows.unread).toEqual([{ key: "S31O6", code: "http_5xx" }]);
  });
});
