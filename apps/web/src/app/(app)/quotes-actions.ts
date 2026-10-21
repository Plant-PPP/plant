"use server";

import { getSessionClaims } from "@/lib/auth/session-claims";
import { requestQuotes } from "@/lib/quotes/request-quotes";

export async function refreshPrices(): Promise<{ ok: boolean }> {
  const claims = await getSessionClaims();
  return { ok: await requestQuotes(claims.sub) };
}
