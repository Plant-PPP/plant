import "server-only";
import { inngestJobRunner } from "@plant/jobs";

import { serverLog } from "@/lib/log/server-log";

// Asks the quotes job to run now: a symbol just loaded gets its last close
// instead of waiting for the evening run. Whether the request went out.
export async function requestQuotes(userId: string): Promise<boolean> {
  try {
    await inngestJobRunner().refreshQuotes();
    serverLog.info("quotes.refresh_requested", { "enduser.id": userId });
    return true;
  } catch (error) {
    serverLog.error(
      "quotes.refresh_requested",
      { "enduser.id": userId },
      error,
    );
    return false;
  }
}
