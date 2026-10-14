import "server-only";
import {
  feedErrorForStatus,
  type GetJson,
  type PostForm,
  QuoteFeedError,
} from "@plant/core";
import { readCappedBytes } from "@plant/shared";

const TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

// Read by name: the DOMException fetch rejects with can come from another
// realm than this module's Error.
const isTimeout = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "name" in error &&
  error.name === "TimeoutError";

async function readCapped(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const bytes = await readCappedBytes(response, maxBytes, { over: "fail" });
  if (bytes === null) throw new QuoteFeedError("too_large");
  return new TextDecoder().decode(bytes);
}

async function readJson(
  url: string,
  init: RequestInit,
  maxBytes = DEFAULT_MAX_BYTES,
): Promise<unknown> {
  let text: string;
  try {
    const response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "manual",
      cache: "no-store",
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw feedErrorForStatus(response.status);
    }
    text = await readCapped(response, maxBytes);
  } catch (error) {
    if (error instanceof QuoteFeedError) throw error;
    throw new QuoteFeedError(isTimeout(error) ? "timeout" : "fetch_error");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new QuoteFeedError("bad_json");
  }
}

// The quote feeds' HTTP reader. Every error it throws is a QuoteFeedError, and
// none carries the body, the headers, the form or the parser's message.
// Inngest retries the step when the code is retryable. A redirect is answered
// by its status (`http_4xx`, not retried).
export const getJson: GetJson = (url, { headers, maxBytes } = {}) =>
  readJson(url, headers ? { headers: { ...headers } } : {}, maxBytes);

export const postForm: PostForm = (url, form) =>
  readJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
  });
