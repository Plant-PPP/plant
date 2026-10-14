import type { Instrumentation } from "next";

import {
  AUTH_UNAVAILABLE_ERROR,
  authUnavailableReason,
} from "@/lib/auth/session-state";
import { errorDigest } from "@/lib/log/error-type";
import { isLoggedError } from "@/lib/log/logged-error";
import { serverLog } from "@/lib/log/server-log";
import {
  REQUEST_ID_FIELD,
  REQUEST_ID_HEADER,
  requestIdFrom,
} from "@/lib/request-id";

// Outbound URLs that carry a credential in their query: Interactive
// Brokers' Flex Web Service takes the user's Flex token as `t=`.
export const SECRET_QUERY_URLS: readonly RegExp[] = [
  /^https:\/\/[^/?#]*interactivebrokers\.com\/AccountManagement\/FlexWebService\//,
];

const SECRET_QUERY_PARAM = /([?&]t=)[^&#\s]*/g;

// A URL, or a span name holding one, with the credential of a URL in
// SECRET_QUERY_URLS masked; anything else as it came.
export function scrubSecretQuery(text: string): string {
  return SECRET_QUERY_URLS.some((url) => url.test(text.replace(/^\w+ /, "")))
    ? text.replace(SECRET_QUERY_PARAM, "$1<masked>")
    : text;
}

const URL_ATTRIBUTES = ["http.url", "url.full", "http.target", "url.query"];

// Masks the credential in an outbound span's name and URL attributes as the
// span starts, where Next and the fetch instrumentation set them.
const secretQueryScrub = {
  onStart(span: {
    name?: string;
    attributes?: Record<string, unknown>;
    updateName(name: string): unknown;
    setAttribute(key: string, value: string): unknown;
  }) {
    if (span.name) {
      const name = scrubSecretQuery(span.name);
      if (name !== span.name) span.updateName(name);
    }
    for (const key of URL_ATTRIBUTES) {
      const value = span.attributes?.[key];
      if (typeof value !== "string") continue;
      const scrubbed = scrubSecretQuery(value);
      if (scrubbed !== value) span.setAttribute(key, scrubbed);
    }
  },
  onEnd() {},
  forceFlush: () => Promise.resolve(),
  shutdown: () => Promise.resolve(),
};

// Traces go to OTEL_EXPORTER_OTLP_ENDPOINT or _TRACES_ENDPOINT (Dash0 from
// PLA-73). Without one nothing is registered and the OpenTelemetry API stays
// a no-op. Before an endpoint is set, a span processor must scrub the query
// from `http.target`, `http.url` and fetch span names: /auth/callback's
// carries the PKCE code. Outbound calls whose URL carries a credential
// (SECRET_QUERY_URLS) are not traced by the fetch instrumentation, and any
// other span naming one has it masked.
export async function register() {
  if (
    !process.env.OTEL_EXPORTER_OTLP_ENDPOINT &&
    !process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
  ) {
    return;
  }
  // Next keeps a rejected register() and fails every request after it.
  try {
    const { registerOTel } = await import("@vercel/otel");
    registerOTel({
      serviceName: "plant-web",
      attributes: { "service.version": process.env.VERCEL_GIT_COMMIT_SHA },
      instrumentationConfig: { fetch: { ignoreUrls: [...SECRET_QUERY_URLS] } },
      spanProcessors: [secretQueryScrub as never, "auto"],
    });
  } catch (error) {
    serverLog.error("otel.register", {}, error);
  }
}

// Next's errors for a malformed router state header
// (app-render/parse-and-validate-flight-router-state.js), which any client can
// send.
const BAD_ROUTER_STATE = new Set([
  "Multiple router state headers were sent. This is not allowed.",
  "The router state header was too large.",
  "The router state header was sent but could not be parsed.",
]);

// Uncaught errors in pages, route handlers and server actions. The proxy and
// whoever throws a LoggedError log their own, so those are skipped. Next still
// prints its own line too.
export const onRequestError: Instrumentation.onRequestError = (
  error,
  request,
  context,
) => {
  if (context.routeType === "proxy" || isLoggedError(error)) return;
  const fields = {
    [REQUEST_ID_FIELD]: requestIdFrom(request.headers[REQUEST_ID_HEADER]),
    "http.request.method": request.method,
    "http.route": context.routePath,
    "plant.route_type": context.routeType,
    // What the error page gets instead of the error, to find this line from.
    "plant.error.digest": errorDigest(error),
  };
  const unavailable = authUnavailableReason(error);
  if (unavailable) {
    // An Auth outage, or the access token hook off. When the proxy set the
    // header, its own line already records it at its level.
    serverLog.warn("request.error", {
      ...fields,
      "plant.outcome": unavailable,
      "error.type": AUTH_UNAVAILABLE_ERROR,
    });
    return;
  }
  if (error instanceof Error && BAD_ROUTER_STATE.has(error.message)) {
    serverLog.warn("request.error", {
      ...fields,
      "plant.outcome": "bad_request",
      "error.type": "bad_router_state",
    });
    return;
  }
  serverLog.error(
    "request.error",
    { ...fields, "plant.outcome": "error" },
    error,
  );
};
