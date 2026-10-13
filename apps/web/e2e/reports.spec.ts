import { expect, test } from "@playwright/test";

import { CSP_HEADER, REPORTING_HEADER } from "@/lib/csp";
import { REQUEST_ID_HEADER, REQUEST_ID_META } from "@/lib/request-id";

// The browser sends its reports on its own schedule, so the spec checks what
// it is told and what the endpoint takes; route.test.ts checks what is logged.
test("a page tells the browser where to report, with its request id", async ({
  request,
}) => {
  const res = await request.get("/login");
  const requestId = res.headers()[REQUEST_ID_HEADER];
  expect(requestId).toBeDefined();
  const path = `/api/reports?request=${requestId}`;
  expect(res.headers()[CSP_HEADER]).toContain(`report-uri ${path}`);
  expect(res.headers()[CSP_HEADER]).toContain("report-to csp");
  expect(res.headers()[REPORTING_HEADER]).toBe(`csp="${path}"`);
  expect(await res.text()).toContain(
    `<meta name="${REQUEST_ID_META}" content="${requestId}"`,
  );
});

test("the report endpoint takes every format, signed in or not", async ({
  request,
}) => {
  for (const [type, body] of [
    [
      "application/reports+json",
      [{ type: "csp-violation", body: { effectiveDirective: "img-src" } }],
    ],
    ["application/csp-report", { "csp-report": { "blocked-uri": "inline" } }],
    ["application/json", { kind: "error", type: "TypeError" }],
    ["application/json", "not a report"],
  ] as const) {
    const res = await request.post("/api/reports", {
      headers: { "content-type": type },
      data: typeof body === "string" ? body : JSON.stringify(body),
      maxRedirects: 0,
    });
    expect(res.status()).toBe(204);
  }
});
