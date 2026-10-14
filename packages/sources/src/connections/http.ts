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
export const unavailable = () => new SourceError("extraction_failed", true);

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
  } catch {
    throw unavailable();
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
  } catch (error) {
    if (error instanceof SourceError) throw error;
    throw unavailable();
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

// A decimal with more decimals than Plant stores.
const LONG_DECIMAL = /^(-?)(0|[1-9]\d*)\.(\d{8})(\d+)$/;

// A provider's figure as a decimal string, to eight decimals, half away from
// zero; null when it is neither a decimal string nor a JSON number.
export function decimalOf(value: unknown): string | null {
  let text: string | null = null;
  if (typeof value === "string") {
    text = value.trim();
    const long = LONG_DECIMAL.exec(text);
    if (long) {
      const [, sign = "", whole = "0", kept = "", rest = ""] = long;
      const units = BigInt(`${whole}${kept}`) + (rest >= "5" ? 1n : 0n);
      text = units === 0n ? "0" : `${sign}${fromScaled(units)}`;
    }
  } else if (typeof value === "number" && Number.isFinite(value)) {
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

// The ISO 4217 fiat currencies Plant does not keep: all but pesos and
// dollars, and the codes exchanges list as tokens, which a balance there names:
// MNT (Mantle, not the tugrik), SCR (Scroll, not the Seychelles rupee), RON
// (Ronin, not the leu), ERN (Ethernity, not the nakfa), TOP (TOP Network, not
// the pa'anga) and SOS (OpenDAO, not the Somali shilling).
export const OTHER_FIAT: ReadonlySet<string> = new Set(
  `
AED AFN ALL AMD ANG AOA AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BRL
BSD BTN BWP BYN BZD CAD CDF CHF CLP CNY COP CRC CUC CUP CVE CZK DJF DKK DOP DZD
EGP ETB EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HRK HTG HUF IDR
ILS INR IQD IRR ISK JMD JOD JPY KES KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR
LRD LSL LYD MAD MDL MGA MKD MMK MOP MRU MUR MVR MWK MXN MYR MZN NAD NGN NIO NOK
NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RSD RUB RWF SAR SBD SDG SEK
SGD SHP SLE SLL SRD SSP STN SVC SYP SZL THB TJS TMT TND TRY TTD TWD TZS
UAH UGX UYU UZS VED VES VND VUV WST XAF XCD XCG XOF XPF YER ZAR ZMW ZWG ZWL
`
    .split(/\s+/)
    .filter(Boolean),
);

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

// Cash held in several balances of one currency, one row per currency with
// their sum, and how many sums Plant cannot store (below zero).
export function summedCashRows(
  balances: readonly { currency: Currency; amount: string }[],
  confidence: DraftRow["confidence"],
): { rows: DraftRow[]; skipped: number } {
  const sums = new Map<Currency, bigint>();
  for (const { currency, amount } of balances) {
    sums.set(currency, (sums.get(currency) ?? 0n) + toScaled(amount));
  }
  const rows: DraftRow[] = [];
  let skipped = 0;
  for (const [currency, units] of sums) {
    if (units === 0n) continue;
    const quantity = fromScaled(units);
    if (positive(quantity)) rows.push(cashRow(currency, quantity, confidence));
    else skipped += 1;
  }
  return { rows, skipped };
}

// A balance of one symbol as a holding, from the parts it is held in: pesos
// and dollars as cash, anything else in units valued in dollars. "empty"
// when nothing is held, null when the balance is not one Plant can store.
export function heldRow(
  symbol: string,
  parts: readonly unknown[],
): DraftRow | "empty" | null {
  let quantity: string;
  try {
    let units = 0n;
    for (const part of parts) {
      const decimal = decimalOf(part);
      if (decimal === null) return null;
      units += toScaled(decimal);
    }
    if (units === 0n) return "empty";
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

// An exchange's balance of one currency as a holding, from the parts it is
// held in (what is free and what open orders hold), as heldRow reads it;
// null too in a fiat Plant does not keep.
export function balanceRow(
  code: string,
  parts: readonly unknown[],
): DraftRow | "empty" | null {
  const symbol = code.trim().toUpperCase();
  if (!ASSET.test(symbol)) return null;
  const row = heldRow(symbol, parts);
  return row !== "empty" && OTHER_FIAT.has(symbol) ? null : row;
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
