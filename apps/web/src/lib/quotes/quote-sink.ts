import "server-only";
import {
  type HistoricalFxRate,
  type QuotedInstrument,
  QuoteStoreError,
  type QuoteStorePort,
} from "@plant/core";
import { classifyPostgrestResult } from "@/lib/supabase/postgrest-write";
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
      const result = await client.rpc("meet_price_alerts");
      const failure = classifyPostgrestResult(result, 200);
      if (failure) throw new Error(`price alerts: ${failure.code}`);
      return result.data ?? 0;
    },
  };
}

// Inserts the past dollar rates fx_rates lacks, through the function only the
// service role may run; how many it inserted.
export function fxHistorySink(): {
  backfill(rows: readonly HistoricalFxRate[]): Promise<number>;
} {
  const client = createServiceRoleClient();
  return {
    backfill: async (rows) => {
      if (!client) throw new Error("fx backfill: unconfigured");
      const result = await client.rpc("backfill_fx_rates", {
        p_rows: [...rows],
      });
      const failure = classifyPostgrestResult(result, 200);
      if (failure) throw new Error(`fx backfill: ${failure.code}`);
      return result.data ?? 0;
    },
  };
}

const CATALOG_PAGE = 1000;

// The catalog's instruments the quote feeds price, past RLS: the job has no
// user. Read a page at a time, past PostgREST's row cap.
export function quotedInstruments(): () => Promise<QuotedInstrument[]> {
  const client = createServiceRoleClient();
  return async () => {
    if (!client) throw new Error("instruments: unconfigured");
    const all: QuotedInstrument[] = [];
    for (let from = 0; ; from += CATALOG_PAGE) {
      const result = await client
        .from("instruments")
        .select("symbol, type, currency")
        .order("symbol")
        .range(from, from + CATALOG_PAGE - 1);
      const failure = classifyPostgrestResult(result, [200, 206]);
      if (failure) throw new Error(`instruments: ${failure.code}`);
      const page = result.data ?? [];
      all.push(...page);
      if (page.length < CATALOG_PAGE) return all;
    }
  };
}
