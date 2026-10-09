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
