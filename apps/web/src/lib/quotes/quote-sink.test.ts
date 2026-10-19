import { createClient, type SupabaseClient } from "@supabase/supabase-js";

jest.mock("server-only", () => ({}), { virtual: true });
let mockClient: SupabaseClient | null = null;
jest.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => mockClient,
}));

import { QuoteStoreError } from "@plant/core";
import { Constants } from "@plant/shared";

import {
  fxHistorySink,
  priceAlertsSink,
  quotedInstruments,
  quoteSink,
} from "./quote-sink";

const [, , SOURCE] = Constants.public.Enums.quote_source;

const rows = { fxRates: [], prices: [] };

it("rejects every save with unconfigured when there is no secret key", async () => {
  mockClient = null;
  const error = await quoteSink()
    .save(rows)
    .catch((e: unknown) => e);
  expect(error).toBeInstanceOf(QuoteStoreError);
  expect(error).toMatchObject({ code: "unconfigured", retryable: false });
});

it("saves with the service-role client", async () => {
  const fetch = jest.fn(
    async () =>
      new Response(JSON.stringify([{ symbol: "BTC" }]), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
  );
  mockClient = createClient("http://127.0.0.1:54321", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch },
  });
  const saved = await quoteSink().save({
    fxRates: [],
    prices: [
      {
        symbol: "BTC",
        price_date: "2026-10-09",
        price: "1",
        currency: "USD",
        source: SOURCE,
        quoted_at: "2026-10-09T21:05:00.000Z",
        fetched_at: "2026-10-09T21:05:00.000Z",
      },
    ],
  });
  expect(saved).toEqual({ fxRates: 0, prices: 1 });
  expect(fetch).toHaveBeenCalledWith(
    expect.stringMatching(/^http:\/\/127\.0\.0\.1:54321\/rest\/v1\/prices\?/),
    expect.objectContaining({ method: "POST" }),
  );
});

describe("priceAlertsSink", () => {
  it("fails without the secret key, so the job logs it", async () => {
    mockClient = null;
    await expect(priceAlertsSink().meet()).rejects.toThrow("unconfigured");
  });

  it("runs the check as the service role and returns how many it met", async () => {
    const fetch = jest.fn<Promise<Response>, [string | URL | Request]>(
      async () =>
        new Response("3", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    mockClient = createClient("http://127.0.0.1:54321", "test-key", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch },
    });
    expect(await priceAlertsSink().meet()).toBe(3);
    expect(String(fetch.mock.calls[0]?.[0])).toBe(
      "http://127.0.0.1:54321/rest/v1/rpc/meet_price_alerts",
    );
  });

  it("names a request that never reached the database", async () => {
    mockClient = createClient("http://127.0.0.1:54321", "test-key", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: async () => {
          throw new TypeError("fetch failed");
        },
      },
    });
    await expect(priceAlertsSink().meet()).rejects.toThrow(
      "price alerts: fetch_error",
    );
  });

  it("names the database's code for a refused check", async () => {
    mockClient = createClient("http://127.0.0.1:54321", "test-key", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: async () =>
          new Response(JSON.stringify({ code: "42501", message: "denied" }), {
            status: 403,
            headers: { "content-type": "application/json" },
          }),
      },
    });
    await expect(priceAlertsSink().meet()).rejects.toThrow(
      "price alerts: 42501",
    );
  });
});

describe("fxHistorySink", () => {
  it("fails without the secret key, so the job logs it", async () => {
    mockClient = null;
    await expect(fxHistorySink().backfill([])).rejects.toThrow("unconfigured");
  });

  it("sends the rows to the backfill function as the service role", async () => {
    const fetch = jest.fn<
      Promise<Response>,
      [string | URL | Request, RequestInit?]
    >(
      async () =>
        new Response("1", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    mockClient = createClient("http://127.0.0.1:54321", "test-key", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch },
    });
    const row = {
      kind: "mep",
      rate_date: "2026-07-01",
      buy: null,
      sell: "1190.25",
    } as const;
    expect(await fxHistorySink().backfill([row])).toBe(1);
    expect(String(fetch.mock.calls[0]?.[0])).toBe(
      "http://127.0.0.1:54321/rest/v1/rpc/backfill_fx_rates",
    );
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
      p_rows: [row],
    });
  });
});

describe("quotedInstruments", () => {
  const clientAnswering = (pages: unknown[][]) => {
    const fetch = jest.fn(
      async () =>
        new Response(JSON.stringify(pages.shift() ?? []), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    mockClient = createClient("http://127.0.0.1:54321", "test-key", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch },
    });
    return fetch;
  };

  it("reads the catalog a page at a time until a short page", async () => {
    const full = Array.from({ length: 1000 }, (_, i) => ({
      symbol: `S${i}`,
      type: "cedear",
      currency: "ARS",
    }));
    const fetch = clientAnswering([
      full,
      [{ symbol: "BTC", type: "crypto", currency: "USD" }],
    ]);
    const read = await quotedInstruments()();
    expect(read).toHaveLength(1001);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenLastCalledWith(
      expect.stringMatching(
        /\/instruments\?select=symbol%2Ctype%2Ccurrency&order=symbol\.asc&offset=1000&limit=1000$/,
      ),
      expect.anything(),
    );
  });

  it("fails unconfigured without a secret key", async () => {
    mockClient = null;
    await expect(quotedInstruments()()).rejects.toThrow(
      "instruments: unconfigured",
    );
  });
});
