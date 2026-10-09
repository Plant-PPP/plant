import {
  type FxRate,
  type Price,
  type QuoteBatch,
  type QuoteFeedCode,
  type GetJson,
  QuoteFeedError,
  type QuoteFeedPort,
  quoteFeeds,
  type QuoteStorePort,
  QuoteStoreError,
  type Refusal,
} from "@plant/core";
import { BUENOS_AIRES_TZ, Constants, type LogFields } from "@plant/shared";
import { NonRetriableError } from "inngest";

import { loadWithEnv, restoreEnv } from "../testing";
import {
  type QuoteJobDeps,
  type QuoteSteps,
  REFRESH_QUOTES_CRON,
  runRefreshQuotes,
} from "./refresh-quotes";

const [DOLLARS, INDEX, CRYPTO] = Constants.public.Enums.quote_source;
const RETRIES = 2;
const RUN_ID = "01M8Z3K4567890QWERTYXABCDE";

const fxRate = (kind: FxRate["kind"], rate_date: string): FxRate => ({
  kind,
  rate_date,
  buy: kind === "uva" ? null : "1",
  sell: "2",
  source: DOLLARS,
  quoted_at: "2026-10-09T21:00:00.000Z",
  fetched_at: "2026-10-09T21:05:00.000Z",
});

const price = (symbol: string): Price => ({
  symbol,
  price_date: "2026-10-09",
  price: "1",
  currency: "USD",
  source: CRYPTO,
  quoted_at: "2026-10-09T21:05:00.000Z",
  fetched_at: "2026-10-09T21:05:00.000Z",
});

const batch = (
  rows: Partial<Pick<QuoteBatch, "fxRates" | "prices">> = {},
  refused: Partial<Record<Refusal, string[]>> = {},
  unread: string[] = [],
): QuoteBatch => ({
  fxRates: rows.fxRates ?? [],
  prices: rows.prices ?? [],
  refused: { early: [], closed: [], stale: [], invalid: [], ...refused },
  unread,
});

// The feeds return batches already classified: the window and weekday rules
// are core's, tested there.
type Read = () => Promise<QuoteBatch>;
const feed = (id: QuoteFeedPort["id"], ...reads: Read[]): QuoteFeedPort => {
  let call = 0;
  return {
    id,
    read: async () => {
      const read = reads[Math.min(call, reads.length - 1)];
      call += 1;
      if (!read) throw new Error("no read");
      return read();
    },
  };
};
const ok =
  (value: QuoteBatch): Read =>
  async () =>
    value;
const fail =
  (error: Error): Read =>
  async () => {
    throw error;
  };

type Line = {
  level: string;
  event: string;
  fields: LogFields;
  error?: unknown;
};

function deps(
  feeds: QuoteFeedPort[],
  store: Partial<QuoteStorePort> = {},
): QuoteJobDeps & { lines: Line[]; save: jest.Mock } {
  const lines: Line[] = [];
  const save = jest.fn(
    store.save ??
      (async (rows) => ({
        fxRates: rows.fxRates.length,
        prices: rows.prices.length,
      })),
  );
  let tick = Date.parse("2026-10-09T21:05:00.000Z");
  return {
    feeds,
    store: { save },
    save,
    lines,
    // Each read of the clock is 10 ms after the last.
    now: () => new Date((tick += 10)),
    log: {
      info: (event, fields = {}) =>
        lines.push({ level: "info", event, fields }),
      warn: (event, fields = {}) =>
        lines.push({ level: "warn", event, fields }),
      error: (event, fields = {}, error) =>
        lines.push({ level: "error", event, fields, error }),
    },
  };
}

type Memo = { value: unknown } | { error: { name: string; message: string } };

// Drives the handler the way the Inngest server does: each request replays
// it from the top with the steps run so far memoized, runs the next step and
// stops. A step that throws is retried in a new request with the attempt
// count raised; after the last retry its error is memoized with only its name
// and message, as a StepError keeps them.
async function drive(
  jobDeps: QuoteJobDeps,
  memo = new Map<string, Memo>(),
): Promise<{ result?: unknown; thrown?: unknown; requests: number }> {
  let attempt = 0;
  for (let requests = 1; requests <= 50; requests += 1) {
    let halt!: () => void;
    const halted = new Promise<"halt">((resolve) => {
      halt = () => resolve("halt");
    });
    const step: QuoteSteps = {
      run: async (id, fn) => {
        const hit = memo.get(id);
        if (hit && "value" in hit) return hit.value as never;
        if (hit) throw hit.error;
        try {
          memo.set(id, { value: await fn() });
          attempt = 0;
        } catch (error) {
          const { name, message } = error as Error;
          if (attempt < RETRIES) attempt += 1;
          else {
            memo.set(id, { error: { name, message } });
            attempt = 0;
          }
        }
        halt();
        return new Promise<never>(() => {});
      },
    };
    const outcome = await Promise.race([
      runRefreshQuotes(jobDeps, { step, runId: RUN_ID, attempt }).then(
        (result) => ({ result, requests }),
        (thrown: unknown) => ({ thrown, requests }),
      ),
      halted,
    ]);
    if (outcome !== "halt") return outcome;
  }
  throw new Error("the handler never finished");
}

const runLines = (lines: Line[]) =>
  lines.filter((line) => line.event === "quotes.refresh");
const feedLines = (lines: Line[]) =>
  lines.filter((line) => line.event === "quotes.feed_failed");

const RUN_FIELDS = [
  "error.type",
  "plant.inngest.run_id",
  "plant.outcome",
  "plant.quotes.closed_keys",
  "plant.quotes.duration_ms",
  "plant.quotes.early_keys",
  "plant.quotes.failed_codes",
  "plant.quotes.fx_rate_count",
  "plant.quotes.invalid_count",
  "plant.quotes.invalid_keys",
  "plant.quotes.price_count",
  "plant.quotes.slowest_feed",
  "plant.quotes.stage",
  "plant.quotes.stale_keys",
  "plant.quotes.unread",
];
const definedKeys = (fields: LogFields) =>
  Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key]) => key)
    .sort();

const TODAY = "2026-10-09";
const dollars = () =>
  batch({
    fxRates: ["official", "mep", "ccl", "blue"].map((k) =>
      fxRate(k as FxRate["kind"], TODAY),
    ),
  });
const index = () => batch({ fxRates: [fxRate("uva", TODAY)] });
const crypto = () => batch({ prices: [price("BTC"), price("ETH")] });

describe("runRefreshQuotes", () => {
  it("saves every feed and writes one ok line at info", async () => {
    const d = deps([
      feed(DOLLARS, ok(dollars())),
      feed(INDEX, ok(index())),
      feed(CRYPTO, ok(crypto())),
    ]);
    const { result, requests } = await drive(d);
    expect(result).toEqual({ outcome: "ok", fxRates: 5, prices: 2 });
    expect(requests).toBe(4);
    expect(d.save).toHaveBeenCalledTimes(3);
    expect(d.lines).toHaveLength(1);
    const [line] = d.lines;
    expect(line?.level).toBe("info");
    expect(line?.fields).toEqual({
      "plant.inngest.run_id": RUN_ID,
      "plant.outcome": "ok",
      "plant.quotes.duration_ms": 30,
      "plant.quotes.slowest_feed": DOLLARS,
      "plant.quotes.fx_rate_count": 5,
      "plant.quotes.price_count": 2,
      "plant.quotes.invalid_count": 0,
      "plant.quotes.unread": "",
      "plant.quotes.failed_codes": "",
      "plant.quotes.stage": undefined,
      "error.type": undefined,
      "plant.quotes.early_keys": "",
      "plant.quotes.closed_keys": "",
      "plant.quotes.stale_keys": "",
      "plant.quotes.invalid_keys": "",
    });
  });

  it("saves the other feeds when one is down, and ends partial", async () => {
    const d = deps([
      feed(DOLLARS, fail(new QuoteFeedError("http_5xx"))),
      feed(INDEX, ok(index())),
      feed(CRYPTO, ok(crypto())),
    ]);
    const { result } = await drive(d);
    expect(result).toEqual({ outcome: "partial", fxRates: 1, prices: 2 });
    expect(feedLines(d.lines)).toHaveLength(RETRIES + 1);
    expect(
      feedLines(d.lines).map((line) => line.fields["plant.inngest.attempt"]),
    ).toEqual([0, 1, 2]);
    const [run] = runLines(d.lines);
    expect(run?.level).toBe("warn");
    expect(run?.fields).toMatchObject({
      "plant.outcome": "partial",
      "plant.quotes.failed_codes": `${DOLLARS}:read:http_5xx`,
      "plant.quotes.stage": "read",
      "error.type": "http_5xx",
      "plant.quotes.duration_ms": 20,
    });
    expect(definedKeys(run!.fields)).toEqual(RUN_FIELDS);
  });

  it("writes the exact fields of a feed line", async () => {
    const d = deps([feed(DOLLARS, fail(new QuoteFeedError("http_4xx")))]);
    await drive(d);
    const [line] = feedLines(d.lines);
    expect(line?.level).toBe("warn");
    expect(line?.fields).toEqual({
      "plant.inngest.run_id": RUN_ID,
      "plant.inngest.attempt": 0,
      "plant.quotes.source": DOLLARS,
      "plant.quotes.stage": "read",
      "plant.quotes.step_ms": 10,
      "error.type": "http_4xx",
      "plant.quotes.store_code": undefined,
    });
  });

  it("does not retry a non-retryable read code", async () => {
    const d = deps([
      feed(DOLLARS, fail(new QuoteFeedError("bad_shape"))),
      feed(INDEX, ok(index())),
    ]);
    await drive(d);
    expect(feedLines(d.lines)).toHaveLength(1);
    expect(runLines(d.lines)[0]?.fields["plant.quotes.failed_codes"]).toBe(
      `${DOLLARS}:read:bad_shape`,
    );
  });

  it("logs any other error at error level with its class, and reads it as _OTHER", async () => {
    const bug = new TypeError("boom");
    const d = deps([feed(DOLLARS, fail(bug)), feed(INDEX, ok(index()))]);
    await drive(d);
    const [line] = feedLines(d.lines);
    expect([line?.level, line?.error]).toEqual(["error", bug]);
    expect(line?.fields["error.type"]).toBeUndefined();
    expect(feedLines(d.lines)).toHaveLength(1);
    expect(runLines(d.lines)[0]?.fields).toMatchObject({
      "plant.quotes.failed_codes": `${DOLLARS}:read:_OTHER`,
      "error.type": "_OTHER",
    });
  });

  it("reads again when the store refuses the day on the first save", async () => {
    const save = jest
      .fn()
      .mockRejectedValueOnce(new QuoteStoreError("out_of_window", "PT403"))
      .mockImplementation(async (rows) => ({
        fxRates: rows.fxRates.length,
        prices: 0,
      }));
    const read = jest.fn(async () => index());
    const d = deps([{ id: INDEX, read }], { save });
    const { result } = await drive(d);
    expect(result).toEqual({ outcome: "ok", fxRates: 1, prices: 0 });
    expect(read).toHaveBeenCalledTimes(2);
    expect(feedLines(d.lines)[0]?.fields).toMatchObject({
      "plant.quotes.stage": "save",
      "error.type": "out_of_window",
      "plant.quotes.store_code": "PT403",
    });
  });

  // Another copy of core in the bundle builds errors of another class with the
  // same name, so retryability comes from the name and code alone.
  it("retries a store error from another copy of core", async () => {
    const copy = Object.assign(new Error("out_of_window"), {
      name: "QuoteStoreError",
      storeCode: "PT403",
    });
    const save = jest
      .fn()
      .mockRejectedValueOnce(copy)
      .mockImplementation(async (rows) => ({
        fxRates: rows.fxRates.length,
        prices: 0,
      }));
    const d = deps([feed(INDEX, ok(index()))], { save });
    const { result } = await drive(d);
    expect(result).toEqual({ outcome: "ok", fxRates: 1, prices: 0 });
    expect(feedLines(d.lines)[0]?.level).toBe("warn");
    expect(feedLines(d.lines)[0]?.fields).toMatchObject({
      "error.type": "out_of_window",
      "plant.quotes.store_code": "PT403",
    });
  });

  it("does not retry a non-retryable store code, and logs the store's code", async () => {
    const save = jest.fn(async () => {
      throw new QuoteStoreError("invalid_row", "23514");
    });
    const d = deps([feed(INDEX, ok(index())), feed(CRYPTO, ok(crypto()))], {
      save,
    });
    const { thrown } = await drive(d);
    expect(thrown).toBeInstanceOf(NonRetriableError);
    expect(save).toHaveBeenCalledTimes(2);
    expect(
      feedLines(d.lines).map((line) => line.fields["plant.quotes.store_code"]),
    ).toEqual(["23514", "23514"]);
    expect(runLines(d.lines)[0]?.fields).toMatchObject({
      "plant.quotes.failed_codes": [
        `${INDEX}:save:invalid_row`,
        `${CRYPTO}:save:invalid_row`,
      ]
        .sort()
        .join(","),
      "plant.quotes.stage": "save",
    });
  });

  it("ends failed at error level and is not retried when every feed failed", async () => {
    const d = deps([
      feed(DOLLARS, fail(new QuoteFeedError("http_4xx"))),
      feed(INDEX, fail(new QuoteFeedError("http_5xx"))),
      feed(CRYPTO, fail(new QuoteFeedError("timeout"))),
    ]);
    const { thrown } = await drive(d);
    expect(thrown).toBeInstanceOf(NonRetriableError);
    const runs = runLines(d.lines);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.level).toBe("error");
    expect(runs[0]?.fields).toMatchObject({
      "plant.outcome": "failed",
      "plant.quotes.failed_codes": [
        `${CRYPTO}:read:timeout`,
        `${DOLLARS}:read:http_4xx`,
        `${INDEX}:read:http_5xx`,
      ]
        .sort()
        .join(","),
      "plant.quotes.duration_ms": 10,
      "plant.quotes.slowest_feed": DOLLARS,
    });
    expect(feedLines(d.lines)).toHaveLength(1 + 2 * (RETRIES + 1));
  });

  it("leaves duration and the slowest feed out when no step returned", async () => {
    const d = deps([feed(INDEX, fail(new QuoteFeedError("http_5xx")))]);
    await drive(d);
    const fields = runLines(d.lines)[0]!.fields;
    expect(fields["plant.quotes.duration_ms"]).toBeUndefined();
    expect(fields["plant.quotes.slowest_feed"]).toBeUndefined();
  });

  it("ends partial at warn when a row was invalid", async () => {
    const d = deps([
      feed(CRYPTO, ok(batch({ prices: [price("ETH")] }, { invalid: ["BTC"] }))),
    ]);
    await drive(d);
    const [run] = runLines(d.lines);
    expect(run?.level).toBe("warn");
    expect(run?.fields).toMatchObject({
      "plant.outcome": "partial",
      "plant.quotes.invalid_keys": "BTC",
      "plant.quotes.invalid_count": 1,
      "plant.quotes.failed_codes": "",
    });
    expect(run?.fields["error.type"]).toBeUndefined();
  });

  it("counts the unread houses as invalid and lists them", async () => {
    const d = deps([
      feed(
        DOLLARS,
        ok(
          batch(
            { fxRates: [fxRate("mep", TODAY)] },
            { invalid: ["blue", "ccl"] },
            ["ccl:http_4xx", "blue:http_5xx"],
          ),
        ),
      ),
    ]);
    await drive(d);
    expect(runLines(d.lines)[0]?.fields).toMatchObject({
      "plant.outcome": "partial",
      "plant.quotes.unread": "blue:http_5xx,ccl:http_4xx",
      "plant.quotes.invalid_keys": "blue,ccl",
    });
  });

  it.each([
    [
      "a weekday at 15:00: only UVA is due",
      batch({}, { early: ["official", "mep", "ccl", "blue"] }),
      batch({ prices: [] }, { early: ["BTC", "ETH"] }),
      "ok",
      {
        "plant.quotes.early_keys": "BTC,ETH,blue,ccl,mep,official",
        "plant.quotes.stale_keys": "",
      },
    ],
    [
      "a weekday at 18:05 with one house a day behind",
      batch(
        {
          fxRates: [
            fxRate("official", TODAY),
            fxRate("mep", TODAY),
            fxRate("ccl", TODAY),
          ],
        },
        { stale: ["blue"] },
      ),
      crypto(),
      "stale",
      { "plant.quotes.stale_keys": "blue" },
    ],
    [
      "a Saturday with Friday's dollars",
      batch({}, { closed: ["official", "mep", "ccl", "blue"] }),
      crypto(),
      "ok",
      { "plant.quotes.closed_keys": "blue,ccl,mep,official" },
    ],
    [
      "a Saturday with a house dated Wednesday",
      batch({}, { closed: ["official", "mep", "ccl"], stale: ["blue"] }),
      crypto(),
      "stale",
      { "plant.quotes.stale_keys": "blue" },
    ],
  ] as const)(
    "on %s, ends %s",
    async (_label, dollarBatch, cryptoBatch, outcome, fields) => {
      const d = deps([
        feed(DOLLARS, ok(dollarBatch)),
        feed(INDEX, ok(index())),
        feed(CRYPTO, ok(cryptoBatch)),
      ]);
      await drive(d);
      const [run] = runLines(d.lines);
      expect(run?.level).toBe(outcome === "ok" ? "info" : "warn");
      expect(run?.fields).toMatchObject({
        "plant.outcome": outcome,
        ...fields,
      });
    },
  );

  it("ends stale at warn when UVA is stale on a Saturday", async () => {
    const d = deps([
      feed(
        DOLLARS,
        ok(batch({}, { closed: ["official", "mep", "ccl", "blue"] })),
      ),
      feed(INDEX, ok(batch({}, { stale: ["uva"] }))),
    ]);
    await drive(d);
    expect(runLines(d.lines)[0]).toMatchObject({
      level: "warn",
      fields: { "plant.outcome": "stale", "plant.quotes.stale_keys": "uva" },
    });
  });

  it("ends ok with zero counts when every row was already stored", async () => {
    const d = deps([feed(INDEX, ok(index()))], {
      save: async () => ({ fxRates: 0, prices: 0 }),
    });
    expect((await drive(d)).result).toEqual({
      outcome: "ok",
      fxRates: 0,
      prices: 0,
    });
  });

  it("does not call the store when a feed kept no rows", async () => {
    const d = deps([feed(DOLLARS, ok(batch({}, { early: ["mep"] })))]);
    await drive(d);
    expect(d.save).not.toHaveBeenCalled();
  });

  it("does not save a memoized feed again while a later feed retries", async () => {
    const read = jest
      .fn<Promise<QuoteBatch>, [Date]>()
      .mockRejectedValueOnce(new QuoteFeedError("http_5xx"))
      .mockResolvedValue(crypto());
    const d = deps([feed(INDEX, ok(index())), { id: CRYPTO, read }]);
    const { result } = await drive(d);
    expect(result).toEqual({ outcome: "ok", fxRates: 1, prices: 2 });
    expect(d.save.mock.calls.map(([rows]) => rows)).toEqual([
      { fxRates: [fxRate("uva", TODAY)], prices: [] },
      { fxRates: [], prices: [price("BTC"), price("ETH")] },
    ]);
    expect(feedLines(d.lines)).toHaveLength(1);
  });

  it("ends partial with the save stage after a retryable save fails every attempt", async () => {
    const save = jest.fn(async () => {
      throw new QuoteStoreError("timeout");
    });
    const d = deps([feed(INDEX, ok(index())), feed(CRYPTO, ok(batch()))], {
      save,
    });
    const { result } = await drive(d);
    expect(result).toEqual({ outcome: "partial", fxRates: 0, prices: 0 });
    expect(save).toHaveBeenCalledTimes(RETRIES + 1);
    expect(
      feedLines(d.lines).map((line) => [
        line.fields["plant.inngest.attempt"],
        line.fields["plant.quotes.stage"],
        line.fields["error.type"],
      ]),
    ).toEqual([
      [0, "save", "timeout"],
      [1, "save", "timeout"],
      [2, "save", "timeout"],
    ]);
    expect(runLines(d.lines)[0]?.fields).toMatchObject({
      "plant.quotes.failed_codes": `${INDEX}:save:timeout`,
      "plant.quotes.stage": "save",
      "error.type": "timeout",
      "plant.quotes.slowest_feed": CRYPTO,
    });
  });

  it.each([
    [
      "a failed feed outranks a stale key",
      [
        feed(DOLLARS, ok(batch({}, { stale: ["blue"] }))),
        feed(INDEX, fail(new QuoteFeedError("bad_shape"))),
      ],
      "partial",
    ],
    [
      "an invalid row outranks a stale key",
      [feed(DOLLARS, ok(batch({}, { stale: ["blue"], invalid: ["ccl"] })))],
      "partial",
    ],
    [
      "early and closed keys alone",
      [feed(DOLLARS, ok(batch({}, { early: ["mep"], closed: ["blue"] })))],
      "ok",
    ],
  ] as const)("on %s, ends %s", async (_label, feeds, outcome) => {
    const d = deps([...feeds]);
    await drive(d);
    expect(runLines(d.lines)[0]?.fields["plant.outcome"]).toBe(outcome);
  });

  it("never saves rows from forged memoized output", async () => {
    const read = jest.fn(async () => index());
    const d = deps([{ id: INDEX, read }]);
    const forged = {
      ok: true,
      fxRates: 9,
      prices: 9,
      refused: { early: [], closed: [], stale: [], invalid: [] },
      unread: [],
      ms: 1,
      rows: [fxRate("blue", TODAY)],
    };
    await drive(d, new Map([[`refresh-${INDEX}`, { value: forged }]]));
    expect(read).not.toHaveBeenCalled();
    expect(d.save).not.toHaveBeenCalled();
  });
});

describe("refresh-quotes registration", () => {
  afterEach(restoreEnv);

  const quotes = jest.fn(() => deps([]));
  const load = (env: Record<string, string>, withQuotes: boolean) =>
    loadWithEnv(env, () => {
      const { createServeOptions } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require("../index") as typeof import("../index");
      return createServeOptions(withQuotes ? { quotes } : {});
    });
  const ids = (options: ReturnType<typeof load>) =>
    options.functions.map((fn) => fn.id());

  beforeEach(() => quotes.mockClear());

  it("registers refresh-quotes in dev-server mode", () => {
    expect(ids(load({ NODE_ENV: "development" }, true))).toEqual([
      "ping",
      "refresh-quotes",
    ]);
    expect(quotes).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["outside development", { NODE_ENV: "production" }, true],
    [
      "outside development with INNGEST_DEV=1",
      { NODE_ENV: "production", INNGEST_DEV: "1" },
      true,
    ],
    ["without its dependencies", { NODE_ENV: "development" }, false],
  ])(
    "registers only ping %s, and builds no dependencies",
    (_label, env, withQuotes) => {
      expect(ids(load(env, withQuotes))).toEqual(["ping"]);
      expect(quotes).not.toHaveBeenCalled();
    },
  );

  it("runs every hour from the close until 23:05, Buenos Aires time", () => {
    expect(REFRESH_QUOTES_CRON).toBe(`TZ=${BUENOS_AIRES_TZ} 5 18-23 * * *`);
  });
});

// The real feeds, built by the factory over an injected reader, through the
// job: what each adapter records, rethrows or fails reaches the run line.
describe("runRefreshQuotes over the factory's feeds", () => {
  const stamp = "2026-10-09T20:57:00.000Z";
  // Invented answers in each provider's shape, all dated today.
  const answer = (url: string): unknown => {
    const { hostname } = new URL(url);
    if (hostname === "dolarapi.com") {
      return { compra: 1, venta: 2, fechaActualizacion: stamp };
    }
    if (hostname === "api.argentinadatos.com") {
      return [{ fecha: TODAY, valor: 1603.33 }];
    }
    const result = Object.fromEntries(
      ["XXBTZUSD", "XETHZUSD", "SOLUSD", "USDTZUSD", "USDCUSD"].map((key) => [
        key,
        { c: ["1", "1"] },
      ]),
    );
    return { error: [], result };
  };
  const reader = (
    override: (url: string) => unknown = () => undefined,
  ): GetJson & jest.Mock =>
    jest.fn(async (url: string) => {
      const value = override(url);
      if (value instanceof Error) throw value;
      return value ?? answer(url);
    });
  const forOne = (suffix: string, value: unknown) => (url: string) =>
    url.endsWith(suffix) ? value : undefined;
  const callsTo = (getJson: jest.Mock, suffix: string) =>
    getJson.mock.calls.filter(([url]) => String(url).endsWith(suffix)).length;

  it("saves every feed once when every source answers", async () => {
    const getJson = reader();
    const d = deps([...quoteFeeds({ getJson })]);
    const { result } = await drive(d);
    expect(result).toEqual({ outcome: "ok", fxRates: 5, prices: 5 });
    // Four houses, one index, one ticker.
    expect(getJson).toHaveBeenCalledTimes(6);
  });

  it("records a house that changed shape as unread and keeps the others, without a retry", async () => {
    const getJson = reader(forOne("/blue", { compra: null }));
    const d = deps([...quoteFeeds({ getJson })]);
    const { result } = await drive(d);
    expect(result).toMatchObject({ outcome: "partial", fxRates: 4 });
    expect(callsTo(getJson, "/blue")).toBe(1);
    expect(feedLines(d.lines)).toEqual([]);
    expect(runLines(d.lines)[0]?.fields).toMatchObject({
      "plant.quotes.unread": "blue:bad_shape",
      "plant.quotes.failed_codes": "",
    });
  });

  it("fails the dollar feed with an unknown class, at error level and once, when a house throws a bug", async () => {
    const bug = new TypeError("boom");
    const getJson = reader(forOne("/blue", bug));
    const d = deps([...quoteFeeds({ getJson })]);
    await drive(d);
    expect(callsTo(getJson, "/blue")).toBe(1);
    const [line] = feedLines(d.lines);
    expect([line?.level, line?.error]).toEqual(["error", bug]);
    expect(runLines(d.lines)[0]?.fields).toMatchObject({
      "plant.quotes.failed_codes": "dolarapi:read:_OTHER",
      "plant.quotes.fx_rate_count": 1,
    });
  });

  it("reads a QuoteFeedError name with a message outside the codes as a bug, not a house", async () => {
    const forged = Object.assign(new Error("provider said no"), {
      name: "QuoteFeedError",
    });
    const getJson = reader(forOne("/blue", forged));
    const d = deps([...quoteFeeds({ getJson })]);
    await drive(d);
    expect(callsTo(getJson, "/blue")).toBe(1);
    const [line] = feedLines(d.lines);
    expect([line?.level, line?.error]).toEqual(["error", forged]);
    expect(runLines(d.lines)[0]?.fields).toMatchObject({
      "plant.quotes.failed_codes": "dolarapi:read:_OTHER",
      "plant.quotes.unread": "",
    });
  });

  it("does not record a store error a house threw as an unread house", async () => {
    const getJson = reader(forOne("/blue", new QuoteStoreError("forbidden")));
    const d = deps([...quoteFeeds({ getJson })]);
    await drive(d);
    expect(runLines(d.lines)[0]?.fields).toMatchObject({
      "plant.quotes.unread": "",
      "plant.quotes.failed_codes": "dolarapi:read:forbidden",
    });
  });

  it("retries the dollar feed and ends with the retryable code when every house fails", async () => {
    const codes: Record<string, QuoteFeedCode> = {
      oficial: "http_4xx",
      bolsa: "bad_json",
      contadoconliqui: "timeout",
      blue: "http_5xx",
    };
    const getJson = reader((url) => {
      const code = codes[url.split("/").pop() ?? ""];
      return code ? new QuoteFeedError(code) : undefined;
    });
    const d = deps([...quoteFeeds({ getJson })]);
    const { result } = await drive(d);
    expect(result).toMatchObject({ outcome: "partial", fxRates: 1 });
    expect(callsTo(getJson, "/blue")).toBe(RETRIES + 1);
    expect(runLines(d.lines)[0]?.fields).toMatchObject({
      "plant.quotes.failed_codes": "dolarapi:read:timeout",
      "plant.quotes.stage": "read",
    });
  });

  it("retries an index series with no entry up to today as empty", async () => {
    const getJson = reader(forOne("/uva", [{ fecha: "2026-10-10", valor: 1 }]));
    const d = deps([...quoteFeeds({ getJson })]);
    await drive(d);
    expect(callsTo(getJson, "/uva")).toBe(RETRIES + 1);
    expect(runLines(d.lines)[0]?.fields).toMatchObject({
      "plant.quotes.failed_codes": "argentinadatos:read:empty",
    });
  });

  it("fails an index whose only row is invalid as bad_shape, without a retry", async () => {
    const getJson = reader(forOne("/uva", [{ fecha: TODAY, valor: 0 }]));
    const d = deps([...quoteFeeds({ getJson })]);
    await drive(d);
    expect(callsTo(getJson, "/uva")).toBe(1);
    expect(runLines(d.lines)[0]?.fields).toMatchObject({
      "plant.quotes.failed_codes": "argentinadatos:read:bad_shape",
    });
  });

  it.each([
    ["EService:Unavailable", "provider_busy", RETRIES + 1],
    ["EQuery:Unknown asset pair", "provider_error", 1],
  ] as const)("reads a ticker error %s as %s", async (entry, code, calls) => {
    const getJson = reader((url) =>
      url.includes("kraken") ? { error: [entry] } : undefined,
    );
    const d = deps([...quoteFeeds({ getJson })]);
    await drive(d);
    expect(callsTo(getJson, "SOLUSD,USDTUSD,USDCUSD")).toBe(calls);
    expect(runLines(d.lines)[0]?.fields).toMatchObject({
      "plant.quotes.failed_codes": `kraken:read:${code}`,
    });
  });

  it("fails a ticker that named no pair as bad_shape", async () => {
    const getJson = reader((url) =>
      url.includes("kraken") ? { error: [], result: {} } : undefined,
    );
    const d = deps([...quoteFeeds({ getJson })]);
    await drive(d);
    expect(runLines(d.lines)[0]?.fields).toMatchObject({
      "plant.quotes.failed_codes": "kraken:read:bad_shape",
    });
  });
});
