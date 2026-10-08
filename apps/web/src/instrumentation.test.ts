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

let warn: jest.SpyInstance;
let error: jest.SpyInstance;

beforeEach(() => {
  registerOTel.mockReset();
  warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  error = jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  for (const name of ENDPOINTS) delete process.env[name];
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

  it.each(ENDPOINTS)("registers plant-web when %s is set", async (name) => {
    process.env[name] = "https://otlp.example";
    await register();
    expect(registerOTel).toHaveBeenCalledTimes(1);
    expect(registerOTel).toHaveBeenCalledWith(
      expect.objectContaining({ serviceName: "plant-web" }),
    );
  });

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
      path: "/assets/1?code=s3cr3t",
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
      "error.type": "Error",
      "exception.message": "failed for <masked>",
    });
    expect(line["exception.stacktrace"]).toEqual(expect.any(String));
    expect(JSON.stringify(line)).not.toContain("s3cr3t");
  });

  it("drops a request id that is not one the proxy minted", async () => {
    await onRequestError(new Error("x"), request("attacker\nvalue"), context);
    expect(lineOf(error)).not.toHaveProperty("plant.request_id");
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
