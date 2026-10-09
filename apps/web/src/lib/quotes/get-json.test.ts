import { feedErrorForStatus, QuoteFeedError } from "@plant/core";

jest.mock("server-only", () => ({}), { virtual: true });

import { getJson } from "./get-json";

const URL = "https://quotes.test/v1/x";
const MAX_BYTES = 2 * 1024 * 1024;
const ORIGINAL_FETCH = global.fetch;

let fetchMock: jest.Mock;
const answer = (response: Response | (() => never)) => {
  fetchMock = jest.fn(async () =>
    typeof response === "function" ? response() : response,
  );
  global.fetch = fetchMock as unknown as typeof fetch;
};

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
});

const stream = (chunks: Uint8Array[], cancel?: () => void) =>
  new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks.shift();
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
    cancel,
  });

const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error("resolved");
    },
    (error: unknown) => error,
  );

it("returns the parsed JSON", async () => {
  answer(new Response(JSON.stringify({ venta: 1450 }), { status: 200 }));
  await expect(getJson(URL)).resolves.toEqual({ venta: 1450 });
});

it("follows no redirect and passes a timeout signal", async () => {
  answer(new Response("{}", { status: 200 }));
  await getJson(URL);
  expect(fetchMock).toHaveBeenCalledWith(
    URL,
    expect.objectContaining({
      redirect: "manual",
      signal: expect.any(AbortSignal),
    }),
  );
});

it("refuses a redirect by its status, so it is not retried", async () => {
  answer(new Response(null, { status: 301, headers: { location: URL } }));
  await expect(failure(getJson(URL))).resolves.toMatchObject({
    code: "http_4xx",
    retryable: false,
  });
});

it("refuses a body whose length is over the cap before reading it", async () => {
  const body = stream([new Uint8Array(1)]);
  answer(
    new Response(body, {
      status: 200,
      headers: { "content-length": String(MAX_BYTES + 1) },
    }),
  );
  await expect(getJson(URL)).rejects.toMatchObject({ code: "too_large" });
});

it("stops reading a body that grows past the cap with no length", async () => {
  const chunk = new Uint8Array(512 * 1024).fill(32);
  const cancel = jest.fn();
  const chunks = Array.from({ length: 8 }, () => chunk);
  answer(new Response(stream(chunks, cancel), { status: 200 }));
  await expect(getJson(URL)).rejects.toMatchObject({ code: "too_large" });
  expect(cancel).toHaveBeenCalled();
});

it("reads a body of exactly the cap", async () => {
  const text = `"${"a".repeat(MAX_BYTES - 2)}"`;
  answer(new Response(text, { status: 200 }));
  await expect(getJson(URL)).resolves.toHaveLength(MAX_BYTES - 2);
});

it("throws bad_json with no part of the body", async () => {
  answer(new Response("<html>secret provider text", { status: 200 }));
  const error = await failure(getJson(URL));
  expect(error).toBeInstanceOf(QuoteFeedError);
  expect(error).toMatchObject({ code: "bad_json", message: "bad_json" });
  expect(JSON.stringify(error)).not.toContain("secret");
});

it("throws the contract's error for a non-2xx status", async () => {
  answer(new Response("down", { status: 503 }));
  const error = await failure(getJson(URL));
  expect(error).toEqual(feedErrorForStatus(503));
  expect(error).toMatchObject({ code: "http_5xx", retryable: true });
});

it.each([
  ["a network failure", new TypeError("fetch failed"), "fetch_error"],
  [
    "a timeout",
    new DOMException("The operation timed out.", "TimeoutError"),
    "timeout",
  ],
])("maps %s to %s", async (_label, thrown, code) => {
  answer(() => {
    throw thrown;
  });
  const error = await failure(getJson(URL));
  expect(error).toBeInstanceOf(QuoteFeedError);
  expect(error).toMatchObject({ code, retryable: true });
});

it("maps a timeout while reading the body to timeout", async () => {
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.error(
        new DOMException("The operation timed out.", "TimeoutError"),
      );
    },
  });
  answer(new Response(body, { status: 200 }));
  await expect(getJson(URL)).rejects.toMatchObject({ code: "timeout" });
});
