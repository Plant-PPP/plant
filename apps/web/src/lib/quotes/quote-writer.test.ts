import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { type FxRate, type Price, QuoteStoreError } from "@plant/core";
import { Constants } from "@plant/shared";
import { createClient } from "@supabase/supabase-js";

jest.mock("server-only", () => ({}), { virtual: true });

import { createQuoteWriter, GUARD_SQLSTATE } from "./quote-writer";

const [FX_SOURCE, , PRICE_SOURCE] = Constants.public.Enums.quote_source;

const fxRate: FxRate = {
  kind: "mep",
  rate_date: "2026-10-09",
  buy: "1400.5",
  sell: "1450",
  source: FX_SOURCE,
  quoted_at: "2026-10-09T21:00:00.000Z",
  fetched_at: "2026-10-09T21:05:00.000Z",
};
const uva: FxRate = { ...fxRate, kind: "uva", buy: null };
const price: Price = {
  symbol: "BTC",
  price_date: "2026-10-09",
  price: "112345.1",
  currency: "USD",
  source: PRICE_SOURCE,
  quoted_at: "2026-10-09T21:05:00.000Z",
  fetched_at: "2026-10-09T21:05:00.000Z",
};

function writerWith(fetch: jest.Mock) {
  const client = createClient("http://127.0.0.1:54321", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch },
  });
  return createQuoteWriter(client);
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const calls = (fetch: jest.Mock) =>
  (fetch.mock.calls as [string, RequestInit][]).map(([url, init]) => ({
    url: new URL(url),
    init,
  }));

async function failure(save: Promise<unknown>): Promise<QuoteStoreError> {
  const error = await save.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(QuoteStoreError);
  return error as QuoteStoreError;
}

// Fake timers everywhere, so the count below sees a timer a save left behind.
beforeEach(() => {
  jest.useFakeTimers({ advanceTimers: true });
});

afterEach(() => {
  expect(jest.getTimerCount()).toBe(0);
  jest.useRealTimers();
});

it("inserts each table's rows, skipping stored keys, and counts the inserted ones", async () => {
  const fetch = jest.fn(async (url: string) =>
    json(
      201,
      url.includes("/fx_rates")
        ? [{ kind: "mep" }, { kind: "uva" }]
        : [{ symbol: "BTC" }],
    ),
  );
  const saved = await writerWith(fetch).save({
    fxRates: [fxRate, uva],
    prices: [price],
  });
  expect(saved).toEqual({ fxRates: 2, prices: 1 });
  const [fx, prices] = calls(fetch);
  expect(fx?.url.pathname).toBe("/rest/v1/fx_rates");
  expect(fx?.url.searchParams.get("on_conflict")).toBe("kind,rate_date");
  expect(fx?.url.searchParams.get("select")).toBe("kind");
  expect(new Headers(fx?.init.headers).get("prefer")).toContain(
    "resolution=ignore-duplicates",
  );
  expect(JSON.parse(fx?.init.body as string)).toEqual([fxRate, uva]);
  expect(fx?.init.body).toContain('"sell":"1450"');
  expect(prices?.url.pathname).toBe("/rest/v1/prices");
  expect(prices?.url.searchParams.get("on_conflict")).toBe("symbol,price_date");
  expect(prices?.url.searchParams.get("select")).toBe("symbol");
});

it("counts 0 when every row was already stored", async () => {
  const fetch = jest.fn(async () => json(201, []));
  await expect(
    writerWith(fetch).save({ fxRates: [fxRate], prices: [] }),
  ).resolves.toEqual({
    fxRates: 0,
    prices: 0,
  });
});

it("does not call a table with no rows", async () => {
  const fetch = jest.fn(async () => json(201, [{ symbol: "BTC" }]));
  await writerWith(fetch).save({ fxRates: [], prices: [price] });
  expect(calls(fetch).map(({ url }) => url.pathname)).toEqual([
    "/rest/v1/prices",
  ]);
});

it.each([
  [403, GUARD_SQLSTATE, "out_of_window", true],
  [403, "42501", "forbidden", false],
  [400, "23514", "invalid_row", false],
  [400, "23502", "invalid_row", false],
  [400, "22003", "invalid_row", false],
  [400, "22P02", "invalid_row", false],
  [400, "PGRST204", "rejected", false],
  [409, "23505", "rejected", false],
  [503, "08006", "unavailable", true],
])("maps a %i with %s to %s", async (status, sqlstate, code, retryable) => {
  const fetch = jest.fn(async () =>
    json(status, {
      code: sqlstate,
      message: "m",
      details: "Failing row contains (1450).",
    }),
  );
  const error = await failure(
    writerWith(fetch).save({ fxRates: [fxRate], prices: [] }),
  );
  expect([error.code, error.message, error.retryable, error.storeCode]).toEqual(
    [code, code, retryable, sqlstate],
  );
  expect(JSON.stringify(error)).not.toContain("1450");
});

it("maps a 502 with no code to unavailable without a store code", async () => {
  const fetch = jest.fn(
    async () => new Response("<html>Bad Gateway</html>", { status: 502 }),
  );
  const error = await failure(
    writerWith(fetch).save({ fxRates: [fxRate], prices: [] }),
  );
  expect([error.code, error.storeCode]).toEqual(["unavailable", undefined]);
});

it("maps a 401 with no code to rejected without a store code", async () => {
  const fetch = jest.fn(async () => json(401, { message: "Invalid API key" }));
  const error = await failure(
    writerWith(fetch).save({ fxRates: [fxRate], prices: [] }),
  );
  expect([error.code, error.storeCode]).toEqual(["rejected", undefined]);
});

it("maps a failed request to unavailable without a store code", async () => {
  const fetch = jest.fn(async () => {
    throw new TypeError("fetch failed");
  });
  const error = await failure(
    writerWith(fetch).save({ fxRates: [fxRate], prices: [] }),
  );
  expect([error.code, error.retryable, error.storeCode]).toEqual([
    "unavailable",
    true,
    undefined,
  ]);
});

it("times out a request that ignores the abort", async () => {
  jest.useFakeTimers();
  const fetch = jest.fn(() => new Promise<Response>(() => {}));
  const settled = failure(
    writerWith(fetch).save({ fxRates: [fxRate], prices: [] }),
  );
  await jest.advanceTimersByTimeAsync(10_000);
  const error = await settled;
  expect([error.code, error.retryable, error.storeCode]).toEqual([
    "timeout",
    true,
    undefined,
  ]);
});

it("stops at the first table that fails", async () => {
  const fetch = jest.fn(async () => json(400, { code: "23514" }));
  await failure(writerWith(fetch).save({ fxRates: [fxRate], prices: [price] }));
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("is the SQLSTATE both quote guards raise, as last defined", () => {
  const dir = join(__dirname, "../../../../../supabase/migrations");
  const guards = new Map<string, string>();
  for (const file of readdirSync(dir).sort()) {
    const sql = readFileSync(join(dir, file), "utf8");
    for (const [, name, body] of sql.matchAll(
      /CREATE (?:OR REPLACE )?FUNCTION private\.(guard_\w+_insert)\(\)[\s\S]*?\$\$([\s\S]*?)\$\$/g,
    )) {
      if (name && body) guards.set(name, body);
    }
  }
  expect([...guards.keys()].sort()).toEqual([
    "guard_fx_rate_insert",
    "guard_price_insert",
  ]);
  for (const body of guards.values()) {
    expect(body).toContain(`ERRCODE = '${GUARD_SQLSTATE}'`);
  }
});

describe("PostgREST answers captured from the local stack", () => {
  const dollars: FxRate[] = (["official", "mep", "ccl", "blue"] as const).map(
    (kind) => ({ ...fxRate, kind }),
  );

  it("asks for the inserted keys back, so a duplicate counts 0", async () => {
    const fetch = jest.fn(async () => json(201, []));
    await writerWith(fetch).save({ fxRates: dollars, prices: [] });
    const prefer = new Headers(calls(fetch)[0]?.init.headers).get("prefer");
    expect(prefer?.split(",").map((part) => part.trim())).toEqual(
      expect.arrayContaining([
        "resolution=ignore-duplicates",
        "return=representation",
      ]),
    );
  });

  it("counts only the rows a partly duplicate insert returned", async () => {
    const fetch = jest.fn(async () =>
      json(201, [{ kind: "official" }, { kind: "ccl" }, { kind: "blue" }]),
    );
    await expect(
      writerWith(fetch).save({ fxRates: dollars, prices: [] }),
    ).resolves.toEqual({ fxRates: 3, prices: 0 });
  });

  it("counts 0 when a 201 carries no body", async () => {
    const fetch = jest.fn(async () => new Response(null, { status: 201 }));
    await expect(
      writerWith(fetch).save({ fxRates: [fxRate], prices: [] }),
    ).resolves.toEqual({ fxRates: 0, prices: 0 });
  });

  it.each([
    // The guard fires before ON CONFLICT, so a past duplicate is refused too.
    [403, GUARD_SQLSTATE, "out_of_window"],
    // 'NaN' in sell or price, or a NaN buy against a finite sell.
    [400, "23514", "invalid_row"],
    // 'Infinity' overflows numeric(20, 8).
    [400, "22003", "invalid_row"],
    [400, "22P02", "invalid_row"],
    [400, "23502", "invalid_row"],
    // A column the table does not have.
    [400, "PGRST204", "rejected"],
    // A statement timeout rolls back, and a retry is harmless.
    [500, "57014", "unavailable"],
  ])(
    "maps a %i %s with PostgREST's error body to %s",
    async (status, sqlstate, code) => {
      const fetch = jest.fn(async () =>
        json(status, {
          code: sqlstate,
          details: "Failing row contains (mep, 2026-10-09, NaN, NaN).",
          hint: null,
          message: "new row violates a check",
        }),
      );
      const error = await failure(
        writerWith(fetch).save({ fxRates: [fxRate], prices: [] }),
      );
      expect([error.code, error.storeCode]).toEqual([code, sqlstate]);
      expect(JSON.stringify({ ...error, message: error.message })).not.toMatch(
        /Failing row|NaN|violates/,
      );
    },
  );

  it("aborts the request it timed out", async () => {
    jest.useFakeTimers();
    let signal: AbortSignal | undefined;
    const fetch = jest.fn((_url: string, init: RequestInit) => {
      signal = init.signal ?? undefined;
      return new Promise<Response>(() => {});
    });
    const settled = failure(
      writerWith(fetch).save({ fxRates: [fxRate], prices: [] }),
    );
    await jest.advanceTimersByTimeAsync(9_999);
    expect(signal?.aborted).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    expect((await settled).code).toBe("timeout");
    expect(signal?.aborted).toBe(true);
  });

  it("reports nothing of the first table when the second fails after it committed", async () => {
    const fetch = jest.fn(async (url: string) =>
      url.includes("/fx_rates")
        ? json(201, [{ kind: "mep" }])
        : json(503, { code: "PGRST001" }),
    );
    const error = await failure(
      writerWith(fetch).save({ fxRates: [fxRate], prices: [price] }),
    );
    expect([error.code, error.retryable]).toEqual(["unavailable", true]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
