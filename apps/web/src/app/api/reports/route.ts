import { boundedText } from "@/lib/bounded-body";
import { reportLimiter } from "@/lib/reports/limit";
import { parseReports } from "@/lib/reports/parse";
import { serverLog } from "@/lib/log/server-log";
import { REQUEST_ID_FIELD, requestIdFrom } from "@/lib/request-id";

// The largest body read, room for a batch of about 60 violations; a longer
// one is not parsed and is logged as a bad request.
const BODY_LIMIT = 65_536;

const limit = reportLimiter();

// The sender a window counts: the client address Vercel sets.
const senderOf = (request: Request) =>
  request.headers.get("x-real-ip") ??
  request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
  "unknown";

// Browsers report CSP violations here, and the app's pages their own errors:
// unauthenticated, so each line is bounded and each sender limited. It always
// answers 204, as a browser retries any other answer.
export async function POST(request: Request): Promise<Response> {
  const done = new Response(null, { status: 204 });
  const verdict = limit(senderOf(request));
  const requestId = requestIdFrom(
    new URL(request.url).searchParams.get("request"),
  );
  if (verdict !== "logged") {
    if (verdict === "dropped_first") {
      serverLog.warn("browser.report", { "plant.outcome": "dropped" });
    }
    return done;
  }
  // A sender that drops the connection mid-body is not answered either way.
  const text = (await boundedText(request, BODY_LIMIT).catch(() => null)) ?? "";
  const lines = parseReports(request.headers.get("content-type") ?? "", text);
  if (lines === null) {
    serverLog.warn("browser.report", { "plant.outcome": "bad_request" });
    return done;
  }
  for (const line of lines) {
    serverLog.warn(line.event, {
      [REQUEST_ID_FIELD]: requestId,
      ...line.fields,
    });
  }
  return done;
}
