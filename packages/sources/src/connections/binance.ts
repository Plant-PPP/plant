import { fromScaled, toScaled } from "@plant/shared";
import { z } from "zod";

import type { DraftRow } from "../file-upload/draft";
import {
  call,
  hexOf,
  hmacSha256,
  holdingsReading,
  jsonOf,
  notReadOnly,
  positive,
  rejected,
  unavailable,
} from "./http";
import { type ConnectionDeps, defineConnection } from "./port";

export const BINANCE_BASE_URL = "https://api.binance.com";

export const binanceCredentialsSchema = z.object({
  apiKey: z.string().regex(/^[A-Za-z0-9]{16,128}$/),
  apiSecret: z.string().regex(/^[A-Za-z0-9]{16,128}$/),
});
type BinanceCredentials = z.infer<typeof binanceCredentialsSchema>;

// The answers Binance gives a key it does not take: a malformed key, an
// unknown key or one refused from this IP, a bad signature, an unknown key id.
const REJECTED_CODES = new Set([-2014, -2015, -1022, -2008]);

// What a key may do, as Binance lists it. The fields that grant nothing, or
// only reading; every other one must be literally false, so a permission
// Binance adds, or one it answers as anything but false, refuses the key.
const NOT_GRANTING = new Set([
  "ipRestrict",
  "createTime",
  "tradingAuthorityExpirationTime",
  "enableReading",
  "enableFixReadOnly",
]);
const restrictionsSchema = z.record(z.string(), z.unknown());
const isReadOnly = (restrictions: Record<string, unknown>) =>
  Object.entries(restrictions).every(
    ([name, value]) => NOT_GRANTING.has(name) || value === false,
  );

const accountSchema = z.object({
  balances: z.array(
    z.object({ asset: z.string(), free: z.string(), locked: z.string() }),
  ),
});

// An asset as Binance names it: capitals and digits.
const ASSET = /^[A-Z0-9]{1,20}$/;

const signature = async (secret: string, payload: string) =>
  hexOf(await hmacSha256(secret, payload));

// One balance as a holding: what is free and what open orders hold, in
// units. null when it is not a holding Plant can store: a name Binance does
// not use, or more units than a quantity holds.
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
  if (!positive(quantity)) return null;
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
export function binanceConnection({
  baseUrl = BINANCE_BASE_URL,
  fetch: get = fetch,
  now = () => new Date(),
  timeoutMs = 10_000,
}: ConnectionDeps = {}) {
  const signedGet = async (
    path: string,
    params: Record<string, string>,
    { apiKey, apiSecret }: BinanceCredentials,
  ): Promise<unknown> => {
    const query = new URLSearchParams({
      ...params,
      recvWindow: "10000",
      timestamp: String(now().getTime()),
    }).toString();
    const response = await call(
      get,
      `${baseUrl}${path}?${query}&signature=${await signature(apiSecret, query)}`,
      { headers: { "X-MBX-APIKEY": apiKey } },
      timeoutMs,
    );
    const body = await jsonOf(response);
    if (response.ok) return body;
    const code = (body as { code?: unknown } | null)?.code;
    if (
      response.status === 401 ||
      (typeof code === "number" && REJECTED_CODES.has(code))
    ) {
      throw rejected();
    }
    // Rate limits, a clock out of the window, Binance down.
    throw unavailable();
  };

  const check = async (credentials: BinanceCredentials) => {
    const restrictions = restrictionsSchema.safeParse(
      await signedGet("/sapi/v1/account/apiRestrictions", {}, credentials),
    );
    if (!restrictions.success) throw unavailable();
    if (restrictions.data.enableReading !== true) throw rejected();
    if (!isReadOnly(restrictions.data)) throw notReadOnly();
  };

  return defineConnection({
    provider: "binance",
    credentials: binanceCredentialsSchema,
    secrets: ["apiSecret"],
    hintField: "apiKey",
    readOnly: "checked",
    drafts: ["holdings"],
    check,
    async read(credentials) {
      await check(credentials);
      const account = accountSchema.safeParse(
        await signedGet(
          "/api/v3/account",
          { omitZeroBalances: "true" },
          credentials,
        ),
      );
      if (!account.success) throw unavailable();
      const rows: DraftRow[] = [];
      let skipped = 0;
      for (const balance of account.data.balances) {
        const row = rowOf(balance);
        if (row === "empty") continue;
        if (row === null) skipped += 1;
        else rows.push(row);
      }
      return holdingsReading(rows, skipped, now());
    },
  });
}
