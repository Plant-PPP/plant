import { parseReports } from "./parse";

it("keeps a Reporting API violation's directive, blocked origin and page path", () => {
  const lines = parseReports(
    "application/reports+json",
    JSON.stringify([
      {
        type: "csp-violation",
        url: "https://plant.app/assets?token=x",
        body: {
          effectiveDirective: "script-src-elem",
          blockedURL: "https://evil.example/x.js?session=abc",
          documentURL: "https://plant.app/assets?token=x#h",
          disposition: "enforce",
          sample: "alert(document.cookie)",
          sourceFile: "https://plant.app/_next/x.js",
          originalPolicy: "script-src 'nonce-abc'",
        },
      },
      { type: "deprecation", body: {} },
    ]),
  );
  expect(lines).toEqual([
    {
      event: "browser.csp",
      fields: {
        "plant.csp.directive": "script-src-elem",
        "plant.csp.blocked": "https://evil.example",
        "plant.csp.disposition": "enforce",
        "url.path": "/assets",
      },
    },
  ]);
});

it("reads a legacy report, never keeping a directive with its sources", () => {
  const [line] = parseReports(
    "application/csp-report",
    JSON.stringify({
      "csp-report": {
        "violated-directive": "script-src 'self' 'nonce-secret'",
        "blocked-uri": "inline",
        "document-uri": "https://plant.app/",
      },
    }),
  )!;
  expect(line?.fields).toMatchObject({
    "plant.csp.directive": "other",
    "plant.csp.blocked": "inline",
    "url.path": "/",
  });
});

it("names an extension's or a data address only by its kind", () => {
  const blocked = (blockedURL: string) =>
    parseReports(
      "application/reports+json",
      JSON.stringify([{ type: "csp-violation", body: { blockedURL } }]),
    )![0]!.fields["plant.csp.blocked"];
  expect(blocked("moz-extension://3f1c-uuid/content.js")).toBe("extension");
  expect(blocked("chrome-extension://abc/x.js")).toBe("extension");
  expect(blocked("data")).toBe("data");
  expect(blocked("blob:https://plant.app/1")).toBe("blob");
  expect(blocked("ftp://x/y")).toBe("other");
});

it("keeps a client error's kind, type and status, and drops the rest", () => {
  expect(
    parseReports(
      "application/json",
      JSON.stringify({
        kind: "auth",
        type: "AuthRetryableFetchError",
        status: 503,
        digest: "abc123",
        path: "/login?next=/assets",
        message: "secret",
        userId: "u1",
      }),
    ),
  ).toEqual([
    {
      event: "browser.error",
      fields: {
        "plant.report.kind": "auth",
        "url.path": "/login",
        "error.type": "AuthRetryableFetchError",
        "plant.auth.status": 503,
      },
    },
  ]);
});

it("refuses what is none of its formats", () => {
  expect(parseReports("application/json", "{not json")).toBeNull();
  expect(parseReports("application/json", '{"kind":"other"}')).toBeNull();
  expect(parseReports("text/plain", "{}")).toBeNull();
  expect(
    parseReports(
      "application/json",
      JSON.stringify({ kind: "error", type: "x".repeat(200) }),
    )![0]!.fields["error.type"],
  ).toBeUndefined();
});

it("logs at most 10 lines of a batch", () => {
  const batch = Array.from({ length: 30 }, () => ({
    type: "csp-violation",
    body: { effectiveDirective: "img-src" },
  }));
  expect(
    parseReports("application/reports+json", JSON.stringify(batch)),
  ).toHaveLength(10);
});
