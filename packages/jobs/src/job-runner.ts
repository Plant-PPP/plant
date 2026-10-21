import { inngest } from "./client";
import {
  IMPORT_CANCELLED_EVENT,
  IMPORT_REQUESTED_EVENT,
} from "./functions/import-document";
import { REFRESH_QUOTES_EVENT } from "./functions/refresh-quotes";

// What the web app asks of the background jobs; it never names the engine.
export interface JobRunner {
  // Starts reading an import's file. Starting the same import again is a
  // no-op: the event's id is the import's. A `retry` names a later start of
  // an import still queued, whose first job may have ended without settling
  // it, which the engine would otherwise drop as that same event. The job
  // skips an import another run already claimed or that settled meanwhile.
  startImport(input: {
    importId: string;
    userId: string;
    retry?: string;
  }): Promise<void>;
  // Stops the read of an import the user cancelled, if one is running.
  cancelImport(input: { importId: string; userId: string }): Promise<void>;
  // Reads the quotes now, as the hourly run would. A run already going
  // absorbs it.
  refreshQuotes(): Promise<void>;
}

export function inngestJobRunner(client = inngest): JobRunner {
  return {
    async startImport({ importId, userId, retry }) {
      await client.send({
        id: retry ? `import-${importId}-${retry}` : `import-${importId}`,
        name: IMPORT_REQUESTED_EVENT,
        data: { importId, userId },
      });
    },
    async cancelImport({ importId, userId }) {
      await client.send({
        name: IMPORT_CANCELLED_EVENT,
        data: { importId, userId },
      });
    },
    async refreshQuotes() {
      await client.send({ name: REFRESH_QUOTES_EVENT, data: {} });
    },
  };
}
