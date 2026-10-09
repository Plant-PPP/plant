import { quoteFeeds } from "@plant/core";
import { createServeOptions } from "@plant/jobs";
import { serve } from "inngest/next";

import { serverLog } from "@/lib/log/server-log";
import { getJson } from "@/lib/quotes/get-json";
import { quoteSink } from "@/lib/quotes/quote-sink";

// The quotes job runs only under `next dev` for now: plant-staging is also
// production's database.
export const { GET, POST, PUT } = serve(
  createServeOptions({
    quotes: () => ({
      feeds: quoteFeeds({ getJson }),
      store: quoteSink(),
      log: serverLog,
      now: () => new Date(),
    }),
  }),
);
