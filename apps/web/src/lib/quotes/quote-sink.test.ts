import { createClient, type SupabaseClient } from "@supabase/supabase-js";

jest.mock("server-only", () => ({}), { virtual: true });
let mockClient: SupabaseClient | null = null;
jest.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => mockClient,
}));

import { QuoteStoreError } from "@plant/core";

import { quoteSink } from "./quote-sink";

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
        source: "kraken",
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
