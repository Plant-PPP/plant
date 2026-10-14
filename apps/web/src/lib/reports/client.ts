import { reportPathFor } from "@/lib/csp";
import { REQUEST_ID_META, requestIdFrom } from "@/lib/request-id";

import type { ClientKind } from "./parse";

// What the page tells the server about a failure only the browser sees: the
// kind of failure, the error's type or Auth code, and Auth's status. Never its
// message, a secret or a figure.
export type ClientReport = {
  kind: ClientKind;
  type?: string;
  status?: number;
};

// Sends the report with the page's request id, and never fails: reporting a
// failure must not become one.
export function reportClientError(report: ClientReport): void {
  try {
    const requestId = requestIdFrom(
      document.querySelector<HTMLMetaElement>(`meta[name="${REQUEST_ID_META}"]`)
        ?.content,
    );
    const url = requestId ? reportPathFor(requestId) : "/api/reports";
    void fetch(url, {
      method: "POST",
      keepalive: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...report, path: window.location.pathname }),
    }).catch(() => {});
  } catch {
    // Nowhere to report that reporting failed.
  }
}
