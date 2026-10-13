import { quoteFeeds } from "@plant/core";
import { createServeOptions } from "@plant/jobs";
import { serve } from "inngest/next";

import { aiCostSink } from "@/lib/ai/ai-cost-sink";
import { documentExtractor } from "@/lib/ai/document-extractor";
import { fileDeletionSink, importSink } from "@/lib/imports/import-sink";
import { serverLog } from "@/lib/log/server-log";
import { getJson } from "@/lib/quotes/get-json";
import { quoteSink } from "@/lib/quotes/quote-sink";

// The quotes, import and file deletion jobs run only under `next dev` until PLA-73 registers
// them on a deployment: plant-staging is also production's database.
export const { GET, POST, PUT } = serve(
  createServeOptions({
    quotes: () => ({
      feeds: quoteFeeds({ getJson }),
      store: quoteSink(),
      log: serverLog,
      now: () => new Date(),
    }),
    imports: () => ({
      store: importSink(),
      extract: documentExtractor({ record: aiCostSink() }),
      log: serverLog,
    }),
    files: () => ({
      store: fileDeletionSink(),
      log: serverLog,
      now: () => new Date(),
    }),
  }),
);
