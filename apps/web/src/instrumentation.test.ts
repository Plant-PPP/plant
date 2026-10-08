const registerOTel = jest.fn();

jest.mock("@vercel/otel", () => ({
  registerOTel: (...args: unknown[]) => registerOTel(...args),
}));

import { AuthUnavailableError } from "@/lib/auth/session-state";
import { onRequestError, register } from "./instrumentation";

const ENDPOINTS = [
  "OTEL_EXPORTER_OTLP_ENDPOINT",
  "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
] as const;
const REQUEST_ID = "12345678-aaaa-4bbb-8ccc-dddddddddddd";

let log: jest.SpyInstance;
let warn: jest.SpyInstance;
let error: jest.SpyInstance;

beforeEach(() => {
  registerOTel.mockReset();
  log = jest.spyOn(console, "log").mockImplementation(() => {});
  warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  error = jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  for (const name of ENDPOINTS) delete process.env[name];
  delete process.env.VERCEL_GIT_COMMIT_SHA;
  jest.restoreAllMocks();
});

function lineOf(spy: jest.SpyInstance): Record<string, unknown> {
  expect(spy).toHaveBeenCalledTimes(1);
  return JSON.parse(spy.mock.calls[0][0] as string) as Record<string, unknown>;
}

describe("register", () => {
  it("registers nothing without an endpoint", async () => {
    await register();
    expect(registerOTel).not.toHaveBeenCalled();
  });

  it.each(ENDPOINTS)(
    "registers plant-web at its commit when %s is set",
    async (name) => {
      process.env[name] = "https://otlp.example";
      process.env.VERCEL_GIT_COMMIT_SHA = "abc123";
      await register();
      expect(registerOTel).toHaveBeenCalledTimes(1);
      expect(registerOTel).toHaveBeenCalledWith({
        serviceName: "plant-web",
        attributes: { "service.version": "abc123" },
      });
    },
  );

  it("logs a failed registration instead of rejecting", async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "https://otlp.example";
    registerOTel.mockImplementation(() => {
      throw new Error("bad config");
    });
    await expect(register()).resolves.toBeUndefined();
    expect(lineOf(error)).toMatchObject({
      event: "otel.register",
      "exception.message": "bad config",
    });
  });
});

describe("onRequestError", () => {
  const context = {
    routerKind: "App Router",
    routePath: "/assets/[id]",
    routeType: "render",
    revalidateReason: undefined,
  } as const;

  function request(requestId?: string) {
    return {
      path: "/assets/1?q=s3cr3t",
      method: "GET",
      headers: requestId === undefined ? {} : { "x-request-id": requestId },
    };
  }

  it("logs one error line with the request id, the route and the exception", async () => {
    await onRequestError(
      new Error("failed for ana@example.com"),
      request(REQUEST_ID),
      context,
    );
    const line = lineOf(error);
    expect(line).toMatchObject({
      level: "error",
      event: "request.error",
      "plant.request_id": REQUEST_ID,
      "http.request.method": "GET",
      "http.route": "/assets/[id]",
      "plant.route_type": "render",
      "plant.outcome": "error",
      "error.type": "Error",
      "exception.message": "failed for <masked>",
    });
    expect(line["exception.stacktrace"]).toEqual(expect.any(String));
    expect(JSON.stringify(line)).not.toContain("s3cr3t");
  });

  it("drops a request id with text before its UUID", async () => {
    await onRequestError(new Error("x"), request(`x ${REQUEST_ID}`), context);
    expect(lineOf(error)).not.toHaveProperty("plant.request_id");
  });

  it("drops a request id that is not a UUID", async () => {
    await onRequestError(
      new Error("x"),
      request(`${REQUEST_ID}\n{"forged":1}`),
      context,
    );
    expect(lineOf(error)).not.toHaveProperty("plant.request_id");
  });

  it("skips the proxy, which logs its own errors", async () => {
    await onRequestError(new Error("x"), request(REQUEST_ID), {
      ...context,
      routeType: "proxy",
    });
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it.each([
    "Multiple router state headers were sent. This is not allowed.",
    "The router state header was too large.",
    "The router state header was sent but could not be parsed.",
  ])("warns on a client's bad router state header: %s", async (message) => {
    await onRequestError(new Error(message), request(REQUEST_ID), context);
    expect(error).not.toHaveBeenCalled();
    const line = lineOf(warn);
    expect(line).toMatchObject({
      level: "warn",
      "plant.outcome": "bad_request",
      "error.type": "bad_router_state",
    });
    expect(line).not.toHaveProperty("exception.stacktrace");
  });

  it("warns on an Auth outage thrown from another bundle's class", async () => {
    const foreign = Object.assign(new Error("Auth unavailable"), {
      name: "AuthUnavailableError",
    });
    await onRequestError(foreign, request(REQUEST_ID), context);
    expect(error).not.toHaveBeenCalled();
    expect(lineOf(warn)).toMatchObject({ "plant.outcome": "auth_unavailable" });
  });

  it("warns on an Auth outage, without a stack", async () => {
    await onRequestError(
      new AuthUnavailableError(),
      request(REQUEST_ID),
      context,
    );
    expect(error).not.toHaveBeenCalled();
    const line = lineOf(warn);
    expect(line).toMatchObject({
      level: "warn",
      "plant.outcome": "auth_unavailable",
      "error.type": "AuthUnavailableError",
    });
    expect(line).not.toHaveProperty("exception.stacktrace");
  });
});
