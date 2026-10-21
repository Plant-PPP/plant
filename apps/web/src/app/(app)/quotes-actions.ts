"use server";

import { inngestJobRunner } from "@plant/jobs";

import { getSessionClaims } from "@/lib/auth/session-claims";
import { serverLog } from "@/lib/log/server-log";

// The user asked for every price now: the quotes job runs out of its hour.
export async function refreshPrices(): Promise<{ ok: boolean }> {
  const claims = await getSessionClaims();
  try {
    await inngestJobRunner().refreshQuotes();
    serverLog.info("quotes.refresh_requested", { "enduser.id": claims.sub });
    return { ok: true };
  } catch (error) {
    serverLog.error(
      "quotes.refresh_requested",
      { "enduser.id": claims.sub },
      error,
    );
    return { ok: false };
  }
}
