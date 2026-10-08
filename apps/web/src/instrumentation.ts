import type { Instrumentation } from "next";

import { isAuthUnavailable } from "@/lib/auth/session-state";
import { serverLog } from "@/lib/log/server-log";
import {
  isRequestId,
  REQUEST_ID_FIELD,
  REQUEST_ID_HEADER,
} from "@/lib/request-id";

// Traces go to the OTLP endpoint in OTEL_EXPORTER_OTLP_* (Dash0 from PLA-73).
// Without one nothing is registered and the OpenTelemetry API stays a no-op.
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

// Uncaught errors in pages, route handlers and server actions. The proxy logs
// its own. Next still prints its own line too.
export const onRequestError: Instrumentation.onRequestError = (
  error,
  request,
  context,
) => {
  const requestId = request.headers[REQUEST_ID_HEADER];
  const fields = {
    // Outside the proxy's matcher the header is whatever the client sent.
    [REQUEST_ID_FIELD]: isRequestId(requestId) ? requestId : undefined,
    "http.request.method": request.method,
    "http.route": context.routePath,
    "plant.route_type": context.routeType,
  };
  if (isAuthUnavailable(error)) {
    // Expected during an Auth outage, which the proxy's line already records.
    serverLog.warn("request.error", {
      ...fields,
      "plant.outcome": "auth_unavailable",
      "error.type": error.name,
    });
    return;
  }
  serverLog.error("request.error", fields, error);
};
