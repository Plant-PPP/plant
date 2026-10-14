import { quoteFeeds } from "@plant/core";
import { createServeOptions } from "@plant/jobs";
import {
  createSourceForConnection,
  exchangeAdapters,
  fileUploadSource,
} from "@plant/sources";
import { serve } from "inngest/next";

import { aiCostSink } from "@/lib/ai/ai-cost-sink";
import { columnMapper } from "@/lib/ai/column-mapper";
import { documentExtractor } from "@/lib/ai/document-extractor";
import {
  columnMappingsSink,
  fileDeletionSink,
  importSink,
  orphanFileSink,
} from "@/lib/imports/import-sink";
import { spreadsheetReader } from "@/lib/imports/spreadsheet-reader";
import { serverLog } from "@/lib/log/server-log";
import { getJson } from "@/lib/quotes/get-json";
import { quoteSink } from "@/lib/quotes/quote-sink";

// The quotes, import and file deletion jobs run under `next dev`, and on a
// deployment only where PLANT_RUN_JOBS is "1": plant-staging is also
// production's database, so one environment runs them.
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
      // An uploaded file is read by the file_upload source, a sync by its
      // exchange's.
      source: createSourceForConnection(
        { kind: "file_upload" },
        {
          file_upload: () =>
            fileUploadSource({
              document: documentExtractor({ record: aiCostSink() }),
              sheet: spreadsheetReader({
                mappings: columnMappingsSink(),
                mapColumns: columnMapper({ record: aiCostSink() }),
              }),
            }),
        },
      ),
      exchanges: exchangeAdapters(),
      log: serverLog,
    }),
    files: () => ({
      store: fileDeletionSink(),
      log: serverLog,
      now: () => new Date(),
    }),
    orphans: () => ({ store: orphanFileSink(), log: serverLog }),
  }),
);
