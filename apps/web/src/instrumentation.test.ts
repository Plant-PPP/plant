const registerOTel = jest.fn();

jest.mock("@vercel/otel", () => ({
  registerOTel: (...args: unknown[]) => registerOTel(...args),
}));

import { AuthUnavailableError } from "@/lib/auth/session-state";
import {
  onRequestError,
  register,
  SECRET_QUERY_URLS,
  scrubSecretQuery,
} from "./instrumentation";

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
      expect(registerOTel).toHaveBeenCalledWith(
        expect.objectContaining({
          serviceName: "plant-web",
          attributes: { "service.version": "abc123" },
          instrumentationConfig: { fetch: { ignoreUrls: SECRET_QUERY_URLS } },
        }),
      );
    },
  );

  it("masks the Flex token in a span that names its URL, as the span starts", async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "https://otlp.example";
    await register();
    const [scrub] = (
      registerOTel.mock.calls[0][0] as {
        spanProcessors: {
          onStart: (span: unknown) => void;
        }[];
      }
    ).spanProcessors;
    const url =
      "https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/SendRequest?t=123456789012&q=987654&v=3";
    const span = {
      name: `GET ${url}`,
      attributes: { "http.url": url, "url.full": url, other: url },
      updateName: jest.fn(),
      setAttribute: jest.fn(),
    };
    scrub!.onStart(span);
    const masked =
      "https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/SendRequest?t=<masked>&q=987654&v=3";
    expect(span.updateName).toHaveBeenCalledWith(`GET ${masked}`);
    expect(span.setAttribute.mock.calls).toEqual([
      ["http.url", masked],
      ["url.full", masked],
    ]);
  });

  async function scrubberOf() {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "https://otlp.example";
    await register();
    return (
      registerOTel.mock.calls[0][0] as {
        spanProcessors: { onStart: (span: unknown) => void }[];
      }
    ).spanProcessors[0]!;
  }

  it("masks the Flex token in Next's own fetch span, name and next.span_name", async () => {
    const scrub = await scrubberOf();
    const url =
      "https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/SendRequest?t=123456789012&q=987654&v=3";
    const span = {
      name: `fetch GET ${url}`,
      attributes: { "next.span_name": `fetch GET ${url}`, "http.url": url },
      updateName: jest.fn(),
      setAttribute: jest.fn(),
    };
    scrub.onStart(span);
    const masked =
      "https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/SendRequest?t=<masked>&q=987654&v=3";
    expect(span.updateName).toHaveBeenCalledWith(`fetch GET ${masked}`);
    expect(span.setAttribute.mock.calls).toEqual(
      expect.arrayContaining([
        ["http.url", masked],
        ["next.span_name", `fetch GET ${masked}`],
      ]),
    );
  });

  it("masks the PKCE code in the request span's name and http.target", async () => {
    const scrub = await scrubberOf();
    const code = "0b7c8d2e-1f3a-4b5c-9d6e-7f8a9b0c1d2e";
    const target = `/auth/callback?code=${code}&next=%2Fsettings`;
    const span = {
      name: `GET ${target}`,
      attributes: {
        "http.target": target,
        "http.url": `https://plant.example${target}`,
      },
      updateName: jest.fn(),
      setAttribute: jest.fn(),
    };
    scrub.onStart(span);
    expect(JSON.stringify(span.updateName.mock.calls)).not.toContain(code);
    expect(span.updateName).toHaveBeenCalledWith(
      "GET /auth/callback?code=<masked>&next=%2Fsettings",
    );
    expect(span.setAttribute.mock.calls).toEqual([
      [
        "http.url",
        "https://plant.example/auth/callback?code=<masked>&next=%2Fsettings",
      ],
      ["http.target", "/auth/callback?code=<masked>&next=%2Fsettings"],
    ]);
  });

  it.each([
    "https://api.binance.com/api/v3/account?timestamp=1&t=2",
    "https://example.com/AccountManagement/FlexWebService/SendRequest?t=1",
  ])("leaves %s as it is", (url) => {
    expect(scrubSecretQuery(url)).toBe(url);
  });

  it.each([
    [
      "https://www.interactivebrokers.com/AccountManagement/FlexWebService/GetStatement?q=1&t=999&v=3",
      "https://www.interactivebrokers.com/AccountManagement/FlexWebService/GetStatement?q=1&t=<masked>&v=3",
    ],
  ])("masks the token of %s", (url, masked) => {
    expect(scrubSecretQuery(url)).toBe(masked);
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

  it("logs the digest the error page gets", async () => {
    await onRequestError(
      Object.assign(new Error("x"), { digest: "123abc" }),
      request(REQUEST_ID),
      context,
    );
    expect(lineOf(error)).toMatchObject({ "plant.error.digest": "123abc" });
  });

  it("drops a request id with text before its UUID", async () => {
    await onRequestError(new Error("x"), request(`x ${REQUEST_ID}`), context);
    expect(lineOf(error)).not.toHaveProperty(["plant.request_id"]);
  });

  it("drops a request id that is not a UUID", async () => {
    await onRequestError(
      new Error("x"),
      request(`${REQUEST_ID}\n{"forged":1}`),
      context,
    );
    expect(lineOf(error)).not.toHaveProperty(["plant.request_id"]);
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

  it("skips an error its thrower already logged, from another bundle's class", async () => {
    const logged = Object.assign(new Error("portfolio_setup.read_failed"), {
      name: "LoggedError",
    });
    await onRequestError(logged, request(REQUEST_ID), context);
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  // A warning carries the request's fields and no exception.
  const warnLine = {
    level: "warn",
    event: "request.error",
    "plant.request_id": REQUEST_ID,
    "http.request.method": "GET",
    "http.route": "/assets/[id]",
    "plant.route_type": "render",
  };

  it.each([
    "Multiple router state headers were sent. This is not allowed.",
    "The router state header was too large.",
    "The router state header was sent but could not be parsed.",
  ])("warns on a client's bad router state header: %s", async (message) => {
    await onRequestError(new Error(message), request(REQUEST_ID), context);
    expect(error).not.toHaveBeenCalled();
    expect(lineOf(warn)).toEqual({
      ...warnLine,
      "plant.outcome": "bad_request",
      "error.type": "bad_router_state",
    });
  });

  it("warns on an unavailable session thrown from another bundle's class", async () => {
    const foreign = Object.assign(new Error("Auth unavailable"), {
      name: "AuthUnavailableError",
      reason: "mfa_claim_missing",
    });
    await onRequestError(foreign, request(REQUEST_ID), context);
    expect(error).not.toHaveBeenCalled();
    expect(lineOf(warn)).toEqual({
      ...warnLine,
      "plant.outcome": "mfa_claim_missing",
      "error.type": "AuthUnavailableError",
    });
  });

  it.each(["auth_unavailable", "mfa_claim_missing"] as const)(
    "warns with the reason %s as the outcome, without a stack",
    async (reason) => {
      await onRequestError(
        new AuthUnavailableError(reason),
        request(REQUEST_ID),
        context,
      );
      expect(error).not.toHaveBeenCalled();
      expect(lineOf(warn)).toEqual({
        ...warnLine,
        "plant.outcome": reason,
        "error.type": "AuthUnavailableError",
      });
    },
  );
});
