import { reportLimiter } from "@/lib/reports/limit";
import { parseReports } from "@/lib/reports/parse";
import { serverLog } from "@/lib/log/server-log";
import { REQUEST_ID_FIELD, requestIdFrom } from "@/lib/request-id";

// The largest body read, room for a batch of about 60 violations; a longer
// one is cut, fails to parse, and is logged as a bad request.
const BODY_LIMIT = 65_536;

const limit = reportLimiter();

// A body read up to BODY_LIMIT bytes, whatever length it claims.
async function boundedText(request: Request): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < BODY_LIMIT) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  void reader.cancel().catch(() => {});
  const bytes = new Uint8Array(Math.min(size, BODY_LIMIT));
  let offset = 0;
  for (const chunk of chunks) {
    const part = chunk.subarray(0, bytes.length - offset);
    bytes.set(part, offset);
    offset += part.byteLength;
    if (offset >= bytes.length) break;
  }
  return new TextDecoder().decode(bytes);
}

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
  const text = await boundedText(request).catch(() => "");
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
