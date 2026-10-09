import { readFileSync } from "node:fs";
import { join } from "node:path";

import { type FxRate, type Price, QuoteStoreError } from "@plant/core";
import { createClient } from "@supabase/supabase-js";

jest.mock("server-only", () => ({}), { virtual: true });

import { createQuoteWriter, GUARD_SQLSTATE } from "./quote-writer";

const fxRate: FxRate = {
  kind: "mep",
  rate_date: "2026-10-09",
  buy: "1400.5",
  sell: "1450",
  source: "dolarapi",
  quoted_at: "2026-10-09T21:00:00.000Z",
  fetched_at: "2026-10-09T21:05:00.000Z",
};
const uva: FxRate = { ...fxRate, kind: "uva", buy: null };
const price: Price = {
  symbol: "BTC",
  price_date: "2026-10-09",
  price: "112345.1",
  currency: "USD",
  source: "kraken",
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

it("is the SQLSTATE both quote guards raise", () => {
  const migration = readFileSync(
    join(
      __dirname,
      "../../../../../supabase/migrations/20261009094238_quotes.sql",
    ),
    "utf8",
  );
  expect(migration.split(`ERRCODE = '${GUARD_SQLSTATE}'`)).toHaveLength(3);
});
