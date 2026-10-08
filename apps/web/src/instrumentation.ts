import type { Instrumentation } from "next";

import { isAuthUnavailable } from "@/lib/auth/session-state";
import { errorType, serverLog } from "@/lib/log/server-log";
import {
  REQUEST_ID_FIELD,
  REQUEST_ID_HEADER,
  requestIdFrom,
} from "@/lib/request-id";

// Traces go to OTEL_EXPORTER_OTLP_ENDPOINT or _TRACES_ENDPOINT (Dash0 from
// PLA-73). Without one nothing is registered and the OpenTelemetry API stays
// a no-op. Before an endpoint is set, a span processor must scrub the query
// from `http.target`, `http.url` and fetch span names: /auth/callback's
// carries the PKCE code.
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

// Uncaught errors in pages, route handlers and server actions. The proxy logs
// its own, so a proxy error that reaches here is skipped. Next still prints
// its own line too.
export const onRequestError: Instrumentation.onRequestError = (
  error,
  request,
  context,
) => {
  if (context.routeType === "proxy") return;
  const fields = {
    [REQUEST_ID_FIELD]: requestIdFrom(request.headers[REQUEST_ID_HEADER]),
    "http.request.method": request.method,
    "http.route": context.routePath,
    "plant.route_type": context.routeType,
  };
  if (isAuthUnavailable(error)) {
    // Expected during an Auth outage, which the proxy's line already records.
    serverLog.warn("request.error", {
      ...fields,
      "plant.outcome": "auth_unavailable",
      "error.type": errorType(error),
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
