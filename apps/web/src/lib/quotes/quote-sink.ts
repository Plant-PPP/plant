import "server-only";
import { QuoteStoreError, type QuoteStorePort } from "@plant/core";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { createQuoteWriter } from "./quote-writer";

// Writes the quotes every user reads, past RLS: only the Inngest route may
// import it.
export function quoteSink(): QuoteStorePort {
  const client = createServiceRoleClient();
  if (!client) {
    return { save: () => Promise.reject(new QuoteStoreError("unconfigured")) };
  }
  return createQuoteWriter(client);
}

// Marks met every user's price alerts the latest quotes meet, through the
// function only the service role may run; how many it marked.
export function priceAlertsSink(): { meet(): Promise<number> } {
  const client = createServiceRoleClient();
  return {
    meet: async () => {
      if (!client) throw new Error("price alerts: unconfigured");
      const { data, error } = await client.rpc("meet_price_alerts");
      if (error) throw new Error(`price alerts: ${error.code}`);
      return data;
    },
  };
}
