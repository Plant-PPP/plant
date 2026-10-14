import {
  buenosAiresDate,
  decimalStringSchema,
  positiveDecimalSchema,
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

export const jsonOf = (response: Response): Promise<unknown> =>
  response.json().catch(() => null);

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

export const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
