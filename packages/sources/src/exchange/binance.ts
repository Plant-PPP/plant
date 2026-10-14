import {
  buenosAiresDate,
  fromScaled,
  positiveDecimalSchema,
  toScaled,
} from "@plant/shared";
import { z } from "zod";

import {
  DRAFT_ROW_LIMIT,
  type DraftRow,
  SourceError,
} from "../file-upload/draft";
import type { HoldingsReading } from "../port";
import type { ExchangeCredentials, ExchangeSourcePort } from "./port";

export const BINANCE_BASE_URL = "https://api.binance.com";

export type BinanceOptions = {
  // Binance's REST API; a test points it at a fake.
  baseUrl: string;
  fetch?: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
};

// The answers Binance gives a key it does not take: a malformed key, an
// unknown key or one refused from this IP, a bad signature, an unknown key id.
const REJECTED_CODES = new Set([-2014, -2015, -1022, -2008]);

// What a key may do, as Binance lists it. A permission to read, or to read
// over FIX, is the only one a key Plant takes may hold.
const restrictionsSchema = z.record(z.string(), z.unknown());
const isReadOnly = (restrictions: Record<string, unknown>) =>
  restrictions.enableReading === true &&
  Object.entries(restrictions).every(
    ([name, granted]) =>
      granted !== true ||
      !/^(enable|permits)/.test(name) ||
      /(Reading|ReadOnly)$/.test(name),
  );

const accountSchema = z.object({
  balances: z.array(
    z.object({ asset: z.string(), free: z.string(), locked: z.string() }),
  ),
});

// An asset as Binance names it: capitals and digits.
const ASSET = /^[A-Z0-9]{1,20}$/;

const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

async function signature(secret: string, payload: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
}

// One balance as a holding: what is free and what open orders hold, in
// units. null when it is not a holding Plant can store: nothing held, a
// name Binance does not use, or more units than a quantity holds.
function rowOf(balance: {
  asset: string;
  free: string;
  locked: string;
}): DraftRow | "empty" | null {
  if (!ASSET.test(balance.asset)) return null;
  let quantity: string;
  try {
    const units = toScaled(balance.free) + toScaled(balance.locked);
    if (units <= 0n) return "empty";
    quantity = fromScaled(units);
  } catch {
    return null;
  }
  if (!positiveDecimalSchema.safeParse(quantity).success) return null;
  return {
    symbol: balance.asset,
    quantity,
    price: null,
    value: null,
    currency: "USD",
    confidence: "high",
    page: null,
  };
}

// Binance's spot account by API, read-only: it asks what the key may do and
// the account's balances, each a signed GET, and never calls an endpoint
// that changes anything.
export function binanceSource({
  baseUrl,
  fetch: get = fetch,
  now = () => new Date(),
  timeoutMs = 10_000,
}: BinanceOptions): ExchangeSourcePort {
  const signedGet = async (
    path: string,
    params: Record<string, string>,
    { apiKey, apiSecret }: ExchangeCredentials,
  ): Promise<unknown> => {
    const query = new URLSearchParams({
      ...params,
      recvWindow: "10000",
      timestamp: String(now().getTime()),
    }).toString();
    const url = `${baseUrl}${path}?${query}&signature=${await signature(apiSecret, query)}`;
    let response: Response;
    try {
      response = await get(url, {
        headers: { "X-MBX-APIKEY": apiKey },
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      throw new SourceError("extraction_failed", true, { cause });
    }
    const body: unknown = await response.json().catch(() => null);
    if (response.ok) return body;
    const code = (body as { code?: unknown } | null)?.code;
    if (
      response.status === 401 ||
      (typeof code === "number" && REJECTED_CODES.has(code))
    ) {
      throw new SourceError("connection_rejected", false);
    }
    // Rate limits, a clock out of the window, Binance down: a later
    // attempt may pass.
    throw new SourceError("extraction_failed", true);
  };

  const checkReadOnly = async (credentials: ExchangeCredentials) => {
    const restrictions = restrictionsSchema.safeParse(
      await signedGet("/sapi/v1/account/apiRestrictions", {}, credentials),
    );
    if (!restrictions.success) {
      throw new SourceError("extraction_failed", true);
    }
    if (restrictions.data.enableReading !== true) {
      throw new SourceError("connection_rejected", false);
    }
    if (!isReadOnly(restrictions.data)) {
      throw new SourceError("connection_not_read_only", false);
    }
  };

  return {
    provider: "binance",
    checkReadOnly,
    async read(credentials): Promise<HoldingsReading> {
      await checkReadOnly(credentials);
      const account = accountSchema.safeParse(
        await signedGet(
          "/api/v3/account",
          { omitZeroBalances: "true" },
          credentials,
        ),
      );
      if (!account.success) throw new SourceError("extraction_failed", true);
      const rows: DraftRow[] = [];
      let skippedRows = 0;
      for (const balance of account.data.balances) {
        const row = rowOf(balance);
        if (row === "empty") continue;
        if (row === null || rows.length >= DRAFT_ROW_LIMIT) skippedRows += 1;
        else rows.push(row);
      }
      rows.sort((a, b) => a.symbol.localeCompare(b.symbol));
      return {
        draft: {
          documentDate: buenosAiresDate(now()),
          rows,
          totals: [],
        },
        read: {
          reader: "api",
          mapping: "none",
          skippedRows,
          disputes: 0,
          documentKind: null,
        },
      };
    },
  };
}
