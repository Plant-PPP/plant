import { ping } from "./functions/ping";

export { inngest } from "./client";

// Every function the /api/inngest endpoint serves.
export const functions = [ping];
