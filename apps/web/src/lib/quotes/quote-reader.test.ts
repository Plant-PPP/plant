import { type QuoteRange, QuoteStoreError } from "@plant/core";
import { createClient } from "@supabase/supabase-js";

import { value } from "@/test/supabase-config";

jest.mock("server-only", () => ({}), { virtual: true });

import {
  MAX_ROWS,
  QuoteReadTruncated,
  createQuoteReader,
} from "./quote-reader";

// PostgREST's answer to a counted read: the rows, and the total after the
// slash of Content-Range. 206 when it returned fewer rows than it counted.
const answer = (rows: unknown[], total = rows.length, status = 200) =>
  new Response(JSON.stringify(rows), {
    status,
    headers: {
      "content-type": "application/json",
      "content-range": `0-${Math.max(rows.length - 1, 0)}/${total}`,
    },
  });

function readerWith(fetch: jest.Mock) {
  const client = createClient("http://127.0.0.1:54321", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch },
  });
  return createQuoteReader(client);
}

const calls = (fetch: jest.Mock) =>
  (fetch.mock.calls as [string, RequestInit][]).map(([url, init]) => ({
    url: new URL(url),
    headers: new Headers(init.headers),
  }));

const RANGE: QuoteRange = {
  from: "2026-10-03",
  to: "2026-10-10",
  fxKinds: ["mep", "ccl", "official"],
  symbols: ["BTC", "ETH"],
};

const symbols = (n: number) =>
  Array.from({ length: n }, (_, i) => `S${String(i).padStart(3, "0")}`);

beforeEach(() => {
  jest.useFakeTimers({ advanceTimers: true });
});

afterEach(() => {
  expect(jest.getTimerCount()).toBe(0);
  jest.useRealTimers();
});

it("pins MAX_ROWS to supabase/config.toml's max_rows", () => {
  expect(Number(value("api", "max_rows"))).toBe(MAX_ROWS);
});

it("reads each table once, counted, filtered by key and date, amounts as text", async () => {
  const fetch = jest.fn(async (url: string) =>
    url.includes("/fx_rates")
      ? answer([{ kind: "mep", rate_date: "2026-10-09", sell: "1200" }])
      : answer([
          {
            symbol: "BTC",
            price_date: "2026-10-10",
            price: "65000",
            currency: "USD",
          },
        ]),
  );
  const stored = await readerWith(fetch).read(RANGE);
  expect(stored).toEqual({
    fxRates: [{ kind: "mep", rate_date: "2026-10-09", sell: "1200" }],
    prices: [
      {
        symbol: "BTC",
        price_date: "2026-10-10",
        price: "65000",
        currency: "USD",
      },
    ],
  });
  const [fx, prices] = calls(fetch);
  expect(fx?.url.pathname).toBe("/rest/v1/fx_rates");
  expect(Object.fromEntries(fx!.url.searchParams)).toEqual({
    select: "kind,rate_date,sell:sell::text",
    kind: "in.(mep,ccl,official)",
    rate_date: "lte.2026-10-10",
    limit: "24",
  });
  expect(fx!.url.searchParams.getAll("rate_date")).toEqual([
    "gte.2026-10-03",
    "lte.2026-10-10",
  ]);
  expect(fx!.headers.get("prefer")).toContain("count=exact");
  expect(prices?.url.pathname).toBe("/rest/v1/prices");
  expect(prices!.url.searchParams.get("select")).toBe(
    "symbol,price_date,price:price::text,currency",
  );
  expect(prices!.url.searchParams.get("symbol")).toBe("in.(BTC,ETH)");
  expect(prices!.url.searchParams.get("order")).toBeNull();
  expect(prices!.url.searchParams.get("limit")).toBe("16");
  expect(prices!.headers.get("prefer")).toContain("count=exact");
});

it("reads 125 symbols over 8 days in one price call and 126 in two", async () => {
  const fetch = jest.fn(async () => answer([]));
  await readerWith(fetch).read({ ...RANGE, symbols: symbols(125) });
  expect(
    calls(fetch).filter((c) => c.url.pathname.endsWith("/prices")),
  ).toHaveLength(1);
  fetch.mockClear();
  await readerWith(fetch).read({ ...RANGE, symbols: symbols(126) });
  const priceCalls = calls(fetch).filter((c) =>
    c.url.pathname.endsWith("/prices"),
  );
  expect(priceCalls.map((c) => c.url.searchParams.get("limit"))).toEqual([
    "1000",
    "8",
  ]);
});

it("skips the fx read when no kind is needed", async () => {
  const fetch = jest.fn(async () => answer([]));
  await readerWith(fetch).read({ ...RANGE, fxKinds: [] });
  expect(calls(fetch).map((c) => c.url.pathname)).toEqual(["/rest/v1/prices"]);
});

it("throws QuoteReadTruncated when a read comes back with no count", async () => {
  const fetch = jest.fn(
    async () =>
      new Response("[]", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
  await expect(readerWith(fetch).read(RANGE)).rejects.toThrow(
    "quote read uncounted",
  );
});

it("throws QuoteReadTruncated when PostgREST cut a counted read (206)", async () => {
  const fetch = jest.fn(async () =>
    answer([{ kind: "mep", rate_date: "2026-10-09", sell: "1200" }], 2, 206),
  );
  await expect(readerWith(fetch).read(RANGE)).rejects.toBeInstanceOf(
    QuoteReadTruncated,
  );
});

it.each([
  ["prices for 1000 days", { fxKinds: [] }, "2024-01-15", true],
  ["prices for 1001 days", { fxKinds: [] }, "2024-01-14", false],
  ["three fx kinds for 333 days", { symbols: [] }, "2025-11-12", true],
  ["three fx kinds for 334 days", { symbols: [] }, "2025-11-11", false],
] as const)("bounds the range: %s", async (_label, need, from, accepted) => {
  const fetch = jest.fn(async () => answer([]));
  const read = readerWith(fetch).read({ ...RANGE, ...need, from });
  if (accepted) await expect(read).resolves.toBeDefined();
  else await expect(read).rejects.toThrow(RangeError);
});

it("refuses a range that ends before it starts", async () => {
  const fetch = jest.fn(async () => answer([]));
  await expect(
    readerWith(fetch).read({ ...RANGE, from: "2026-10-11" }),
  ).rejects.toThrow(RangeError);
  expect(fetch).not.toHaveBeenCalled();
});

it.each([
  [403, "42501", "forbidden", false],
  [500, "57014", "unavailable", true],
])("maps a %i %s to %s", async (status, code, quoteCode, retryable) => {
  const fetch = jest.fn(
    async () =>
      new Response(
        JSON.stringify({
          code,
          message: "m",
          details: "row 1450.5",
          hint: null,
        }),
        { status, headers: { "content-type": "application/json" } },
      ),
  );
  const error = await readerWith(fetch)
    .read(RANGE)
    .then(
      () => undefined,
      (e: unknown) => e,
    );
  expect(error).toBeInstanceOf(QuoteStoreError);
  expect(error).toMatchObject({ code: quoteCode, retryable, storeCode: code });
  expect(String((error as Error).message)).not.toContain("1450");
});

it("maps a read that outlasts the deadline to timeout", async () => {
  const fetch = jest.fn(() => new Promise<never>(() => {}));
  const read = readerWith(fetch).read(RANGE);
  const settled = read.then(
    () => undefined,
    (e: unknown) => e,
  );
  await jest.advanceTimersByTimeAsync(10_000);
  expect(await settled).toMatchObject({ code: "timeout" });
});
