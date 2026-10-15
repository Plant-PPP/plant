"use server";

import {
  INSTRUMENT_TYPES,
  type Listing,
  LISTING_MARKETS,
  type ListingMarket,
} from "@plant/core";
import { z } from "zod";

import { getSessionClaims } from "@/lib/auth/session-claims";
import type { InstrumentRow } from "@/lib/holdings/read";
import { catalogSearch } from "@/lib/instruments/catalog-search";
import {
  type AddInstrumentCode,
  addListedInstrument,
} from "@/lib/instruments/instrument-catalog-sink";
import { serverLog } from "@/lib/log/server-log";
import { userLimiter } from "@/lib/reports/limit";
import { REQUEST_ID_FIELD } from "@/lib/request-id";
import { currentRequestId } from "@/lib/request-id-server";
import { classifyPostgrestResult } from "@/lib/supabase/postgrest-write";
import { createClient } from "@/lib/supabase/server";

export type SearchCode = "invalid" | "limited" | "unavailable";
export type SearchResult =
  | { ok: true; listings: Listing[]; failed: ListingMarket[] }
  | { ok: false; code: SearchCode };

const marketsSchema = z.array(z.enum(LISTING_MARKETS)).min(1).max(2).optional();

export type AddResult =
  | { ok: true; instrument: InstrumentRow }
  | { ok: false; code: AddInstrumentCode };

const QUERY_MAX = 60;
const RESULTS = 20;

// A search asks CoinGecko each time, so a user gets thirty a minute. In
// memory, per serverless instance.
const searchLimit = userLimiter({ perUser: 30 });

// What the providers of the given markets (all, when none) list for the
// text a signed-in user types. The text is not logged.
export async function searchInstruments(
  query: unknown,
  markets?: unknown,
): Promise<SearchResult> {
  const claims = await getSessionClaims();
  const requestId = await currentRequestId();
  const started = performance.now();
  let result: SearchResult;
  let failure: unknown;
  const asked = marketsSchema.safeParse(markets);
  if (
    typeof query !== "string" ||
    query.trim() === "" ||
    query.length > QUERY_MAX ||
    !asked.success
  ) {
    result = { ok: false, code: "invalid" };
  } else if (!searchLimit(claims.sub)) {
    result = { ok: false, code: "limited" };
  } else {
    try {
      result = {
        ok: true,
        ...(await catalogSearch().search(query, RESULTS, asked.data)),
      };
    } catch (error) {
      failure = error;
      result = { ok: false, code: "unavailable" };
    }
  }
  const line = {
    [REQUEST_ID_FIELD]: requestId,
    "enduser.id": claims.sub,
    "plant.outcome": result.ok ? "ok" : result.code,
    "plant.count": result.ok ? result.listings.length : 0,
    "plant.instruments.failed": result.ok ? result.failed.join(",") : "",
    "plant.duration_ms": Math.round(performance.now() - started),
  };
  if (failure) serverLog.error("instruments.search", line, failure);
  else if (result.ok) serverLog.info("instruments.search", line);
  else serverLog.warn("instruments.search", line);
  return result;
}

const rowSchema = z.object({
  symbol: z.string(),
  name: z.string(),
  currency: z.enum(["ARS", "USD"]),
  type: z.enum(INSTRUMENT_TYPES),
  aliases: z.array(z.string()),
});

// Adds a listed instrument to the catalog and reads it back as the user sees
// it, which is the one already there when someone added it first.
export async function addInstrument(
  symbol: unknown,
  market: unknown,
): Promise<AddResult> {
  const added = await addListedInstrument(symbol, market);
  if (!added.ok) return added;
  const client = await createClient();
  const result = await client
    .from("instruments")
    .select("symbol, name, currency, type, aliases")
    .eq("symbol", added.symbol)
    .maybeSingle();
  const row = rowSchema.safeParse(result.data);
  if (classifyPostgrestResult(result, 200) || !row.success) {
    return { ok: false, code: "failed" };
  }
  return { ok: true, instrument: row.data };
}
