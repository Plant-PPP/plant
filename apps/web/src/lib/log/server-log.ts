import { isSpanContextValid, trace } from "@opentelemetry/api";

import {
  MASK,
  isSensitiveKey,
  scrubSensitiveText,
} from "@/lib/security/credential-scrub";

// The one way server code logs: a single JSON line per call, flat fields,
// every string scrubbed. Never pass amounts, holdings or extracted data, only
// ids and counts; the masks are a net, not a license. A number passes as it
// is: only its key is checked.

export type LogValue = string | number | boolean | null | undefined;
export type LogFields = Readonly<Record<string, LogValue>>;

export type LogLevel = "info" | "warn" | "error";

const FIELD_LIMITS = { read: 4096, keep: 512 };
const STACK_LIMITS = { read: 8192, keep: 4096 };
// When a value is longer than what is read, a token at the edge of the read
// is cut in half and no pattern recognises it. Masks can shorten the text
// enough to pull that edge into what is kept, so it is dropped first.
const CUT_EDGE = 128;

function clean(value: string, limits: { read: number; keep: number }): string {
  const truncated = value.length > limits.read;
  let text = scrubSensitiveText(value.slice(0, limits.read));
  if (truncated) text = text.slice(0, -CUT_EDGE);
  return truncated || text.length > limits.keep
    ? `${text.slice(0, limits.keep)}…`
    : text;
}

function cleanFields(fields: LogFields | undefined): Record<string, LogValue> {
  const out: Record<string, LogValue> = {};
  for (const [key, value] of Object.entries(fields ?? {})) {
    if (value === undefined) continue;
    if (isSensitiveKey(key)) out[key] = MASK;
    else
      out[key] = typeof value === "string" ? clean(value, FIELD_LIMITS) : value;
  }
  return out;
}

// An error's code when it has one (Auth's, Node's), else its class, so one
// failure reads the same on every line.
export function errorType(
  error: { name?: unknown; code?: unknown } | null | undefined,
): string | undefined {
  const { code, name } = error ?? {};
  if (typeof code === "string" && code) return code;
  return typeof name === "string" && name ? name : undefined;
}

function exceptionFields(error: unknown): Record<string, LogValue> {
  if (!(error instanceof Error)) {
    return { "error.type": typeof error, "exception.type": typeof error };
  }
  // The logger runs on crash paths: a name or message that is not a string
  // must not make it throw.
  const name =
    typeof error.name === "string" && error.name ? error.name : "Error";
  return {
    "error.type": clean(errorType(error) ?? name, FIELD_LIMITS),
    "exception.type": clean(name, FIELD_LIMITS),
    "exception.message": clean(String(error.message), FIELD_LIMITS),
    "exception.stacktrace": error.stack
      ? clean(String(error.stack), STACK_LIMITS)
      : undefined,
  };
}

function traceFields(): Record<string, LogValue> {
  const context = trace.getActiveSpan()?.spanContext();
  const valid = context && isSpanContextValid(context);
  return {
    trace_id: valid ? context.traceId : undefined,
    span_id: valid ? context.spanId : undefined,
  };
}

function write(
  level: LogLevel,
  event: string,
  fields: LogFields | undefined,
  extra: Record<string, LogValue> = {},
): void {
  // The logger's own keys last, so a field cannot overwrite them.
  const line = JSON.stringify({
    ...cleanFields(fields),
    ...extra,
    level,
    event,
    ...traceFields(),
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const serverLog = {
  info(event: string, fields?: LogFields): void {
    write("info", event, fields);
  },
  warn(event: string, fields?: LogFields): void {
    write("warn", event, fields);
  },
  error(event: string, fields?: LogFields, error?: unknown): void {
    write(
      "error",
      event,
      fields,
      error === undefined ? {} : exceptionFields(error),
    );
  },
};
