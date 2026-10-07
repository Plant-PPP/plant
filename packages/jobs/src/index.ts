import { inngest } from "./client";
import { ping } from "./functions/ping";

export { inngest };

// Every function the /api/inngest endpoint serves.
export const functions = [ping];

// Options for the framework `serve()` in apps/web. Unauthenticated syncs stay
// off: an unsigned PUT would otherwise re-register the app with Inngest at a
// URL taken from the request's Host header. Syncs from the dashboard and the
// Vercel integration are signed, so they keep working.
export const serveOptions = {
  client: inngest,
  functions,
  enableUnauthedSync: false,
};
