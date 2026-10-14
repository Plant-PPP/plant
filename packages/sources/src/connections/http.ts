import {
  buenosAiresDate,
  type Currency,
  decimalStringSchema,
  fromScaled,
  positiveDecimalSchema,
  toScaled,
} from "@plant/shared";

import {
  DRAFT_ROW_LIMIT,
  type DraftOperation,
  type DraftRow,
  SourceError,
} from "../file-upload/draft";
import type { HoldingsReading, OperationsReading } from "../port";

export const rejected = () => new SourceError("connection_rejected", false);
export const notReadOnly = () =>
  new SourceError("connection_not_read_only", false);
// The provider did not answer, or not as it documents: a later attempt may.
export const unavailable = (cause?: unknown) =>
  new SourceError("extraction_failed", true, { cause });

// One request to a provider, never following a redirect, within `timeoutMs`;
// a network failure or a timeout is unavailable.
export async function call(
  get: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  try {
    return await get(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (cause) {
    throw unavailable(cause);
  }
}

// The largest JSON answer Plant reads from a provider: a balance or a page of
// transactions is far smaller.
const JSON_MAX_BYTES = 2_000_000;

// An answer larger than Plant reads: a later attempt gets the same one.
const tooLarge = () => new SourceError("extraction_failed", false);

// A response's body as text, read at most `maxBytes` far: one that says it
// is larger is refused unread, and one that streams past it is cut off.
export async function bodyText(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw tooLarge();
  }
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw tooLarge();
      }
      chunks.push(value);
    }
  } catch (cause) {
    if (cause instanceof SourceError) throw cause;
    throw unavailable(cause);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

// A response's JSON, or null when it is not JSON.
export async function jsonOf(
  response: Response,
  maxBytes = JSON_MAX_BYTES,
): Promise<unknown> {
  const text = await bodyText(response, maxBytes);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

// A provider's figure as a decimal string, exact for a string and to eight
// decimals for a JSON number; null when it is neither.
export function decimalOf(value: unknown): string | null {
  let text: string | null = null;
  if (typeof value === "string") text = value.trim();
  else if (typeof value === "number" && Number.isFinite(value)) {
    text = value.toFixed(8).replace(/\.?0+$/, "");
    if (text === "-0") text = "0";
  }
  return text !== null && decimalStringSchema.safeParse(text).success
    ? text
    : null;
}

export const positive = (value: string | null): value is string =>
  value !== null && positiveDecimalSchema.safeParse(value).success;

// Whether a provider's figure is zero: nothing held, rather than a balance
// Plant cannot store.
export function isZero(value: string | null): boolean {
  if (value === null) return false;
  try {
    return toScaled(value) === 0n;
  } catch {
    return false;
  }
}

// Holdings as a draft dated today, at most DRAFT_ROW_LIMIT rows by symbol;
// the rest, and those the adapter could not take, are skipped.
export function holdingsReading(
  rows: DraftRow[],
  skipped: number,
  now: Date,
): HoldingsReading {
  rows.sort((a, b) => a.symbol.localeCompare(b.symbol));
  return {
    draft: {
      documentDate: buenosAiresDate(now),
      rows: rows.slice(0, DRAFT_ROW_LIMIT),
      totals: [],
    },
    read: {
      reader: "api",
      mapping: "none",
      skippedRows: skipped + Math.max(0, rows.length - DRAFT_ROW_LIMIT),
      disputes: 0,
      documentKind: null,
    },
  };
}

// Operations as a draft, newest first, at most DRAFT_ROW_LIMIT of them.
export function operationsReading(
  operations: DraftOperation[],
  skipped: number,
): OperationsReading {
  operations.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  return {
    operations: operations.slice(0, DRAFT_ROW_LIMIT),
    read: {
      reader: "api",
      mapping: "none",
      skippedRows: skipped + Math.max(0, operations.length - DRAFT_ROW_LIMIT),
      disputes: 0,
      documentKind: null,
    },
  };
}

// The HMAC-SHA256 of a payload under a secret, as providers sign requests.
export async function hmacSha256(
  secret: string,
  payload: string,
): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(payload)),
  );
}

export const hexOf = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

export const base64Of = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes));

// The fiat currencies exchanges in the region hold that Plant does not keep.
const OTHER_FIAT = new Set(["MXN", "BRL", "COP", "CLP", "PEN", "UYU", "EUR"]);

// A currency or an asset as an exchange names it, in capitals.
const ASSET = /^[A-Z0-9]{1,20}$/;

// A cash balance as a draft row: its currency's code as its symbol.
export const cashRow = (
  currency: Currency,
  quantity: string,
  confidence: DraftRow["confidence"],
): DraftRow => ({
  symbol: currency,
  quantity,
  price: null,
  value: null,
  assetClass: "cash",
  currency,
  confidence,
  page: null,
});

// An exchange's balance of one currency as a holding, from the parts it is
// held in (what is free and what open orders hold): pesos and dollars as
// cash, a crypto asset in units valued in dollars. "empty" when nothing is
// held, null when the balance is not one Plant can store: below zero, or in
// a fiat Plant does not keep.
export function balanceRow(
  code: string,
  parts: readonly unknown[],
): DraftRow | "empty" | null {
  const symbol = code.trim().toUpperCase();
  if (!ASSET.test(symbol)) return null;
  let quantity: string;
  try {
    let units = 0n;
    for (const part of parts) {
      const decimal = decimalOf(part);
      if (decimal === null) return null;
      units += toScaled(decimal);
    }
    if (units === 0n) return "empty";
    if (units < 0n || OTHER_FIAT.has(symbol)) return null;
    quantity = fromScaled(units);
  } catch {
    return null;
  }
  if (!positive(quantity)) return null;
  if (symbol === "ARS" || symbol === "USD") {
    return cashRow(symbol, quantity, "high");
  }
  return {
    symbol,
    quantity,
    price: null,
    value: null,
    currency: "USD",
    confidence: "high",
    page: null,
  };
}

// Holdings from an exchange's balances, each as balanceRow takes it.
export function balancesReading(
  balances: readonly { code: string; parts: readonly unknown[] }[],
  now: Date,
): HoldingsReading {
  const rows: DraftRow[] = [];
  let skipped = 0;
  for (const { code, parts } of balances) {
    const row = balanceRow(code, parts);
    if (row === "empty") continue;
    if (row === null) skipped += 1;
    else rows.push(row);
  }
  return holdingsReading(rows, skipped, now);
}

export const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

// A read with a wall-time budget, for a provider Plant waits on while it
// generates something: `start` opens the budget, each request gets what is
// left of it (at most `timeoutMs`), and `poll` asks after each wait until an
// answer comes, stopping before a wait that would leave no time to ask again.
export function budgetedRead({
  timeoutMs,
  budgetMs,
  clock,
  sleep,
}: {
  timeoutMs: number;
  budgetMs: number;
  clock: () => number;
  sleep: (ms: number) => Promise<void>;
}) {
  let deadline = Number.POSITIVE_INFINITY;
  const left = () => deadline - clock();
  return {
    start: () => {
      deadline = clock() + budgetMs;
    },
    // One request's timeout; none left is unavailable.
    requestTimeout: () => {
      const budget = Math.min(timeoutMs, left());
      if (budget <= 0) throw unavailable();
      return budget;
    },
    // The first answer `ask` gives after a wait, or undefined when the
    // budget ran out first.
    poll: async <T>(
      waits: readonly number[],
      ask: () => Promise<T | undefined>,
    ): Promise<T | undefined> => {
      for (const wait of waits) {
        if (wait >= left()) break;
        if (wait > 0) await sleep(wait);
        const answer = await ask();
        if (answer !== undefined) return answer;
      }
      return undefined;
    },
  };
}
