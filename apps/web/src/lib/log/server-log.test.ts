import { trace, type Span } from "@opentelemetry/api";

import { MASK } from "@/lib/security/credential-scrub";

import { errorType, serverLog } from "./server-log";

const UUID = "12345678-aaaa-4bbb-8ccc-dddddddddddd";

let log: jest.SpyInstance;
let warn: jest.SpyInstance;
let error: jest.SpyInstance;

beforeEach(() => {
  log = jest.spyOn(console, "log").mockImplementation(() => {});
  warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  error = jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

function lineOf(spy: jest.SpyInstance): Record<string, unknown> {
  expect(spy).toHaveBeenCalledTimes(1);
  const [line] = spy.mock.calls[0] as [string];
  expect(line).not.toContain("\n");
  return JSON.parse(line) as Record<string, unknown>;
}

it("writes one JSON line per call, on the console method of its level", () => {
  serverLog.info("a.info", { n: 1 });
  serverLog.warn("a.warn");
  serverLog.error("a.error");
  expect(lineOf(log)).toEqual({ n: 1, level: "info", event: "a.info" });
  expect(lineOf(warn)).toEqual({ level: "warn", event: "a.warn" });
  expect(lineOf(error)).toEqual({ level: "error", event: "a.error" });
});

it("masks sensitive keys, scrubs values and drops undefined", () => {
  serverLog.info("x", {
    "plant.holding.amount": 1234.5,
    "plant.holdings.count": 12,
    "url.path": "/auth/callback?code=s3cr3t",
    note: "ana@example.com",
    "enduser.id": UUID,
    gone: undefined,
    ok: true,
    nothing: null,
  });
  expect(lineOf(log)).toEqual({
    "plant.holding.amount": MASK,
    "plant.holdings.count": 12,
    "url.path": `/auth/callback?code=${MASK}`,
    note: MASK,
    "enduser.id": UUID,
    ok: true,
    nothing: null,
    level: "info",
    event: "x",
  });
});

it("keeps its own keys when a field has the same name", () => {
  serverLog.info("real", {
    level: "error",
    event: "forged",
    trace_id: "forged",
  });
  expect(lineOf(log)).toEqual({ level: "info", event: "real" });
});

it("scrubs a value before cutting it, so a number across the cut is masked", () => {
  const cbu = "0170099220000067797370";
  const email = "ana@example.com";
  // Both straddle the 512-character cut.
  serverLog.info("x", {
    a: "a ".repeat(250) + cbu,
    b: "b ".repeat(252) + email,
  });
  const line = lineOf(log);
  expect(line.a).toBe("a ".repeat(250) + MASK);
  expect(line.b).toBe("b ".repeat(252) + MASK);
  expect(JSON.stringify(line)).not.toMatch(/0170|ana@|example/);
});

it("does not keep a token cut in half at the edge of what is read", () => {
  const cbu = "0170099220000067797370";
  // The long code shrinks to the mask, pulling the read's edge into view.
  serverLog.info("x", { a: "?code=" + "c".repeat(4080 - 6) + " " + cbu });
  expect(JSON.stringify(lineOf(log))).not.toContain("01700");
});

it("adds no trace ids without an active span", () => {
  serverLog.info("x");
  expect(lineOf(log)).not.toHaveProperty("trace_id");
});

it("adds the active span's trace ids", () => {
  const spanContext = {
    traceId: "0af7651916cd43dd8448eb211c80319c",
    spanId: "b7ad6b7169203331",
    traceFlags: 1,
  };
  jest
    .spyOn(trace, "getActiveSpan")
    .mockReturnValue({ spanContext: () => spanContext } as unknown as Span);
  serverLog.info("x");
  expect(lineOf(log)).toMatchObject({
    trace_id: spanContext.traceId,
    span_id: spanContext.spanId,
  });
});

it("logs an Error's type, message and stack, scrubbed", () => {
  const thrown = new TypeError("bad code=abc for ana@example.com");
  serverLog.error("x", { a: 1 }, thrown);
  const line = lineOf(error);
  expect(line).toMatchObject({
    a: 1,
    "error.type": "TypeError",
    "exception.type": "TypeError",
    "exception.message": `bad code=abc for ${MASK}`,
  });
  expect(line["exception.stacktrace"]).toContain("server-log.test.ts");
  expect(line["exception.stacktrace"]).not.toContain("ana@example.com");
});

it("logs an error's code as its type, and its class as the exception's", () => {
  const thrown = Object.assign(new Error("rate limited"), {
    name: "AuthApiError",
    code: "over_request_rate_limit",
  });
  serverLog.error("x", {}, thrown);
  expect(lineOf(error)).toMatchObject({
    "error.type": "over_request_rate_limit",
    "exception.type": "AuthApiError",
  });
});

describe("errorType", () => {
  it.each([
    [
      "the code",
      { name: "AuthApiError", code: "over_request_rate_limit" },
      "over_request_rate_limit",
    ],
    [
      "the class without a code",
      { name: "AuthRetryableFetchError" },
      "AuthRetryableFetchError",
    ],
    [
      "the class when the code is not a string",
      { name: "DatabaseError", code: 23505 },
      "DatabaseError",
    ],
    [
      "the class when the code is empty",
      { name: "TypeError", code: "" },
      "TypeError",
    ],
    ["nothing without an error", null, undefined],
    ["nothing for no result", undefined, undefined],
  ])("returns %s", (_label, value, type) => {
    expect(errorType(value)).toBe(type);
  });
});

it("cuts a long stack", () => {
  const thrown = new Error("x");
  thrown.stack = "at f\n".repeat(3000);
  serverLog.error("x", {}, thrown);
  const stack = lineOf(error)["exception.stacktrace"] as string;
  expect(stack.length).toBe(4097);
  expect(stack.endsWith("…")).toBe(true);
});

it("logs only the type of something thrown that is not an Error", () => {
  serverLog.error("x", {}, "ana@example.com");
  expect(lineOf(error)).toEqual({
    "error.type": "string",
    "exception.type": "string",
    level: "error",
    event: "x",
  });
});
