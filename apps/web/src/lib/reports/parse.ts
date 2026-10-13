// What a browser sends to /api/reports, reduced to the few fields a log line
// keeps: the body is untrusted and unauthenticated, so every field is bounded
// and anything else is dropped.

// The most lines one request logs.
const LINES_PER_BODY = 10;

export type ReportLine = {
  event: "browser.csp" | "browser.error";
  fields: Record<string, string | number>;
};

// What the page's own reporter sends.
export const CLIENT_KINDS = ["error", "auth", "settings", "realtime"] as const;
export type ClientKind = (typeof CLIENT_KINDS)[number];

const TOKEN = /^[A-Za-z0-9_.-]{1,60}$/;
const DIRECTIVE = /^[a-z-]{1,40}$/;
const DISPOSITION = new Set(["enforce", "report"]);

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const token = (value: unknown, pattern = TOKEN) =>
  typeof value === "string" && pattern.test(value) ? value : undefined;

// A URL's path alone: no query, no fragment, no origin.
function pathOf(value: unknown): string | undefined {
  if (typeof value !== "string" || value === "") return undefined;
  try {
    const { pathname } = new URL(value, "https://plant.invalid");
    return pathname.slice(0, 120);
  } catch {
    return undefined;
  }
}

// What a violation blocked: an http(s) origin, or a keyword. An extension's
// address names the user's browser, so it is only "extension".
function blockedOf(value: unknown): string {
  if (typeof value !== "string" || value === "") return "none";
  if (/^(inline|eval|wasm-eval|trusted-types-[a-z-]+)$/.test(value)) {
    return value;
  }
  if (/^(data|blob):?$/.test(value) || /^(data|blob):/.test(value)) {
    return value.startsWith("data") ? "data" : "blob";
  }
  try {
    const url = new URL(value);
    if (url.protocol === "https:" || url.protocol === "http:") {
      return url.origin.slice(0, 120);
    }
    return /-extension:$/.test(url.protocol) ? "extension" : "other";
  } catch {
    return "other";
  }
}

function cspLine(body: Record<string, unknown>): ReportLine {
  const directive =
    token(body.effectiveDirective, DIRECTIVE) ??
    token(body["effective-directive"], DIRECTIVE) ??
    "other";
  const disposition = body.disposition;
  return {
    event: "browser.csp",
    fields: {
      "plant.csp.directive": directive,
      "plant.csp.blocked": blockedOf(body.blockedURL ?? body["blocked-uri"]),
      "plant.csp.disposition":
        typeof disposition === "string" && DISPOSITION.has(disposition)
          ? disposition
          : "unknown",
      "url.path": pathOf(body.documentURL ?? body["document-uri"]) ?? "unknown",
    },
  };
}

function clientLine(body: Record<string, unknown>): ReportLine | null {
  const kind = CLIENT_KINDS.find((each) => each === body.kind);
  if (!kind) return null;
  const fields: ReportLine["fields"] = {
    "plant.report.kind": kind,
    "url.path": pathOf(body.path) ?? "unknown",
  };
  const type = token(body.type);
  if (type) fields["error.type"] = type;
  if (
    typeof body.status === "number" &&
    Number.isInteger(body.status) &&
    body.status >= 0 &&
    body.status < 600
  ) {
    fields["plant.auth.status"] = body.status;
  }
  return { event: "browser.error", fields };
}

// The lines a report body logs, by its content type: the Reporting API's
// batch, a legacy CSP report, or the page's own error report. Null when it is
// none of them.
export function parseReports(
  contentType: string,
  text: string,
): ReportLine[] | null {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  const type = contentType.split(";")[0]?.trim().toLowerCase();
  if (type === "application/reports+json") {
    if (!Array.isArray(body)) return null;
    return body
      .flatMap((report) => {
        const each = record(report);
        const inner = record(each?.body);
        return each?.type === "csp-violation" && inner ? [cspLine(inner)] : [];
      })
      .slice(0, LINES_PER_BODY);
  }
  if (type === "application/csp-report") {
    const inner = record(record(body)?.["csp-report"]);
    return inner ? [cspLine(inner)] : null;
  }
  if (type === "application/json") {
    const inner = record(body);
    const line = inner && clientLine(inner);
    return line ? [line] : null;
  }
  return null;
}
