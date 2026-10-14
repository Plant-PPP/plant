import "server-only";
import { LISTING_MARKETS } from "@plant/core";
import { z } from "zod";

import { getSessionClaims } from "@/lib/auth/session-claims";
import { serverLog } from "@/lib/log/server-log";
import { userLimiter } from "@/lib/reports/limit";
import { REQUEST_ID_FIELD } from "@/lib/request-id";
import { currentRequestId } from "@/lib/request-id-server";
import { classifyPostgrestResult } from "@/lib/supabase/postgrest-write";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

import { catalogSearch } from "./catalog-search";

// Why an instrument was not added: input that does not parse, too many adds
// in a minute, a symbol the provider does not list (or Kraken does not
// quote), a provider that did not answer, or a failure.
export type AddInstrumentCode =
  "invalid" | "limited" | "not_listed" | "unavailable" | "failed";
export type AddInstrumentResult =
  { ok: true; symbol: string } | { ok: false; code: AddInstrumentCode };

const inputSchema = z.object({
  symbol: z.string().regex(/^[A-Z0-9]{1,15}$/),
  market: z.enum(LISTING_MARKETS),
});

// Each add asks a provider again, so a user gets ten a minute. In memory, per
// serverless instance.
const limit = userLimiter({ perUser: 10 });

const EVENT = "instruments.add";

// Adds to the catalog every user reads the instrument a provider lists under
// the symbol, with the name, type and currency the provider gives, never the
// browser's. An instrument already there is kept as it is. Only the
// instrument actions may import it: it takes no user id and nothing but the
// symbol and its market.
export async function addListedInstrument(
  symbol: unknown,
  market: unknown,
): Promise<AddInstrumentResult> {
  // Outside any try: its redirect to /login or /auth/mfa must propagate.
  const claims = await getSessionClaims();
  const requestId = await currentRequestId();
  const started = performance.now();
  let result: AddInstrumentResult;
  let failure: unknown;
  const input = inputSchema.safeParse({ symbol, market });
  if (!input.success) {
    result = { ok: false, code: "invalid" };
  } else if (!limit(claims.sub)) {
    result = { ok: false, code: "limited" };
  } else {
    try {
      result = await insertListed(input.data.symbol, input.data.market);
    } catch (error) {
      failure = error;
      result = { ok: false, code: "unavailable" };
    }
  }
  const line = {
    [REQUEST_ID_FIELD]: requestId,
    "enduser.id": claims.sub,
    "plant.outcome": result.ok ? "ok" : result.code,
    "plant.duration_ms": Math.round(performance.now() - started),
  };
  if (failure) serverLog.error(EVENT, line, failure);
  else if (result.ok) serverLog.info(EVENT, line);
  else serverLog.warn(EVENT, line);
  return result;
}

async function insertListed(
  symbol: string,
  market: (typeof LISTING_MARKETS)[number],
): Promise<AddInstrumentResult> {
  const listing = await catalogSearch().verify(symbol, market);
  if (!listing) return { ok: false, code: "not_listed" };
  const client = createServiceRoleClient();
  if (!client) return { ok: false, code: "failed" };
  const inserted = await client.from("instruments").upsert(
    {
      symbol: listing.symbol,
      name: listing.name,
      type: listing.type,
      currency: listing.currency,
    },
    { onConflict: "symbol", ignoreDuplicates: true },
  );
  if (classifyPostgrestResult(inserted, [200, 201, 204])) {
    return { ok: false, code: "failed" };
  }
  return { ok: true, symbol: listing.symbol };
}
