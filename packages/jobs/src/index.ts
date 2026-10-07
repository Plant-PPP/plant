import type { ServeHandlerOptions } from "inngest";

import { inngest } from "./client";
import { ping } from "./functions/ping";

// Options for the framework `serve()` in apps/web. Unauthenticated syncs stay
// off: an unsigned PUT would otherwise re-register the app with Inngest at a
// URL taken from the request's Host header. Syncs from the dashboard and the
// Vercel integration are signed, so they keep working. `satisfies` makes a
// misspelled option a type error instead of a silent default.
export const serveOptions = {
  client: inngest,
  functions: [ping],
  enableUnauthedSync: false,
} satisfies ServeHandlerOptions;
