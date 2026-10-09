import type { ServeHandlerOptions } from "inngest";

import { DEV_SERVER_MODE, inngest } from "./client";
import { ping } from "./functions/ping";
import { type QuoteJobDeps, refreshQuotes } from "./functions/refresh-quotes";

export type { QuoteJobDeps } from "./functions/refresh-quotes";

const DEV_SERVE_ORIGIN = "http://127.0.0.1:3000";

// Options for the framework `serve()` in apps/web. Unauthenticated syncs stay
// off: an unsigned PUT would otherwise re-register the app with Inngest at a
// URL taken from the request's Host header. Syncs from the dashboard and the
// Vercel integration are signed, so they keep working. `satisfies` makes a
// misspelled option a type error instead of a silent default.
//
// refresh-quotes registers only in dev-server mode, and only then are its
// dependencies built. Dev mode checks no signature, so its registered URL is
// fixed to the loopback `next dev` binds rather than taken from the request.
export function createServeOptions(opts: { quotes?: () => QuoteJobDeps }) {
  return {
    client: inngest,
    functions:
      DEV_SERVER_MODE && opts.quotes
        ? [ping, refreshQuotes(opts.quotes())]
        : [ping],
    enableUnauthedSync: false,
    ...(DEV_SERVER_MODE ? { serveOrigin: DEV_SERVE_ORIGIN } : {}),
  } satisfies ServeHandlerOptions;
}
