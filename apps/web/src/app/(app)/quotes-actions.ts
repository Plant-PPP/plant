"use server";

import { QUOTE_CLOSE_HOUR } from "@plant/core";
import { buenosAiresHour } from "@plant/shared";

import { getSessionClaims } from "@/lib/auth/session-claims";
import { requestQuotes } from "@/lib/quotes/request-quotes";

// Before the close hour the job keeps no traded price, so the day's prices
// are still the last close.
export async function refreshPrices(): Promise<{
  ok: boolean;
  beforeClose: boolean;
}> {
  const claims = await getSessionClaims();
  const ok = await requestQuotes(claims.sub);
  return { ok, beforeClose: buenosAiresHour(new Date()) < QUOTE_CLOSE_HOUR };
}
