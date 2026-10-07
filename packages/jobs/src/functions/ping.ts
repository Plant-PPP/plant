import { inngest } from "../client";

// Smoke check that the endpoint is registered and steps run, in every
// environment. Send `plant/ping` from the Inngest dashboard or dev server.
export const ping = inngest.createFunction(
  { id: "ping", triggers: [{ event: "plant/ping" }] },
  async ({ step }) => {
    const at = await step.run("respond", () => new Date().toISOString());
    return { ok: true, at };
  },
);
