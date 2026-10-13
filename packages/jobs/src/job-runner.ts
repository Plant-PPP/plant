import { inngest } from "./client";
import { IMPORT_REQUESTED_EVENT } from "./functions/import-document";

// What the web app asks of the background jobs; it never names the engine.
export interface JobRunner {
  // Starts reading an import's file. Starting the same import again is a
  // no-op: the event's id is the import's.
  startImport(input: { importId: string; userId: string }): Promise<void>;
}

export function inngestJobRunner(client = inngest): JobRunner {
  return {
    async startImport({ importId, userId }) {
      await client.send({
        id: `import-${importId}`,
        name: IMPORT_REQUESTED_EVENT,
        data: { importId, userId },
      });
    },
  };
}
