import { aiCostRow } from "@plant/shared";
import { createClient } from "@supabase/supabase-js";

jest.mock("server-only", () => ({}), { virtual: true });

import { AiCostWriteError, createAiCostWriter } from "./ai-cost-writer";

const row = aiCostRow(
  "gemini-3.5-flash-lite",
  {
    userId: "a0000000-0000-4000-8000-00000000000a",
    costType: "import_extraction",
  },
  { input: 10_000, cacheRead: 0, cacheWrite: 0, output: 2_280 },
);

function writerWith(fetch: jest.Mock) {
  // The same auth options as service-role.ts, which lib/ai may not import.
  const client = createClient("http://127.0.0.1:54321", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch },
  });
  return createAiCostWriter(client);
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function failure(write: Promise<void>): Promise<AiCostWriteError> {
  const error = await write.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AiCostWriteError);
  expect((error as Error).name).toBe("AiCostWriteError");
  expect((error as AiCostWriteError).code).toBe((error as Error).message);
  return error as AiCostWriteError;
}

afterEach(() => {
  expect(jest.getTimerCount()).toBe(0);
  jest.useRealTimers();
});

beforeEach(() => {
  jest.useFakeTimers();
});

it("inserts the row with the amount as a decimal string", async () => {
  const fetch = jest.fn(async () => new Response(null, { status: 201 }));
  await writerWith(fetch)(row);
  expect(row.amount_usd).toBe("0.0087");
  const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("http://127.0.0.1:54321/rest/v1/ai_costs");
  expect(init.method).toBe("POST");
  expect(JSON.parse(init.body as string)).toEqual(row);
  expect(init.body).toContain('"amount_usd":"0.0087"');
});

it("throws the SQLSTATE without the failing row", async () => {
  const fetch = jest.fn(async () =>
    json(400, {
      code: "23514",
      message: 'new row violates check constraint "ai_costs_amount_usd_check"',
      details: "Failing row contains (… 0.0087 …).",
      hint: null,
    }),
  );
  const error = await failure(writerWith(fetch)(row));
  expect(error.message).toBe("23514");
  expect(JSON.stringify(error)).not.toContain("0.0087");
  expect(error.stack).not.toContain("0.0087");
  expect(Object.keys(error)).not.toContain("details");
});

it("throws the status when the body has no code", async () => {
  const fetch = jest.fn(async () => json(401, { message: "Invalid API key" }));
  expect((await failure(writerWith(fetch)(row))).message).toBe("http_401");
});

it("throws the status when the body is not JSON", async () => {
  const fetch = jest.fn(
    async () =>
      new Response("<html>Bad Gateway</html>", {
        status: 502,
        headers: { "content-type": "text/html" },
      }),
  );
  expect((await failure(writerWith(fetch)(row))).message).toBe("http_502");
});

it("throws the status when a failed response's body is falsy", async () => {
  const fetch = jest.fn(async () => json(500, null));
  expect((await failure(writerWith(fetch)(row))).message).toBe("http_500");
});

it("throws fetch_error when the request fails", async () => {
  const fetch = jest.fn(async () => {
    throw new TypeError("fetch failed");
  });
  expect((await failure(writerWith(fetch)(row))).message).toBe("fetch_error");
});

it("times out a request that ignores the abort", async () => {
  const fetch = jest.fn(() => new Promise<Response>(() => {}));
  const write = writerWith(fetch)(row);
  const settled = failure(write);
  await jest.advanceTimersByTimeAsync(1500);
  expect((await settled).message).toBe("timeout");
  expect(fetch).toHaveBeenCalledTimes(1);
  const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(init.signal?.aborted).toBe(true);
});

it.each([
  ["timeout", true],
  ["fetch_error", true],
  ["http_502", true],
  ["http_401", false],
  ["23503", false],
  ["PGRST204", false],
  ["missing_key", false],
])("%s may have committed: %s", (code, expected) => {
  expect(new AiCostWriteError(code).mayHaveCommitted).toBe(expected);
});
