import { inngest } from "./client";
import { IMPORT_REQUESTED_EVENT } from "./functions/import-document";

// What the web app asks of the background jobs; it never names the engine.
export interface JobRunner {
  // Starts reading an import's file. Starting the same import again is a
  // no-op: the event's id is the import's. A `retry` names a later start of
  // an import still queued, whose first job may have ended without settling
  // it, which the engine would otherwise drop as that same event. The job
  // skips an import that settled meanwhile, and a second reading replaces
  // the first's draft.
  startImport(input: {
    importId: string;
    userId: string;
    retry?: string;
  }): Promise<void>;
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
  };
}
