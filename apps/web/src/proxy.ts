import { type NextRequest, NextResponse } from "next/server";
import {
  afterLoginPath,
  isPublicPath,
  LOGIN_PATH,
  loginPath,
} from "@/lib/auth/routes";
import { loginErrorMessage } from "@/lib/auth/login-errors";
import { isSessionMissing } from "@/lib/auth/session-state";
import { buildCsp, createNonce, CSP_HEADER, NONCE_HEADER } from "@/lib/csp";
import { createRequestId, REQUEST_ID_HEADER } from "@/lib/request-id";
import { supabaseEnv, supabaseOrigins } from "@/lib/supabase/env";
import { updateSession } from "@/lib/supabase/proxy";

// Every page gets a CSP with a fresh nonce and a request id. Both go on the
// request too: Next reads the nonce from the request's CSP and stamps its
// own scripts, and the root layout passes it to next-themes. `set` replaces
// any copy the client sent.
export async function proxy(request: NextRequest) {
  const nonce = createNonce();
  const requestId = createRequestId();
  const env = supabaseEnv();
  const csp = buildCsp({
    nonce,
    connectOrigins: env ? supabaseOrigins(env.url) : [],
    dev: process.env.NODE_ENV === "development",
  });
  request.headers.set(CSP_HEADER, csp);
  request.headers.set(NONCE_HEADER, nonce);
  request.headers.set(REQUEST_ID_HEADER, requestId);

  const response = await sessionResponse(request);
  response.headers.set(CSP_HEADER, csp);
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

// Checks the session on every page request, refreshes it before it nears
// expiry and sends anyone without one to /login. Server Components cannot
// write cookies, so the exchange happens here.
async function sessionResponse(request: NextRequest) {
  // Without Supabase the layout's own check fails and shows the error page.
  if (!supabaseEnv()) {
    return NextResponse.next({ request: { headers: request.headers } });
  }

  const { pathname, search, searchParams } = request.nextUrl;
  const session = await updateSession(request);

  if (session.claims) {
    // A signed-in user on /login goes where they were headed, unless /login
    // is showing a sign-in error.
    if (
      pathname === LOGIN_PATH &&
      !loginErrorMessage(searchParams.get("error"))
    ) {
      return session.redirect(
        new URL(afterLoginPath(searchParams.get("next")), request.url),
      );
    }
    return session.response();
  }

  if (isSessionMissing(session.error)) {
    if (isPublicPath(pathname)) return session.response();
    return session.redirect(new URL(loginPath(pathname + search), request.url));
  }

  // Auth is unavailable (rate limit, conflict, outage, timeout): a failed
  // refresh deletes no cookie, and the page shows the retry.
  return session.unavailable();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|api/inngest(?:/|$)|.*\\.(?:ico|png|svg|jpg|jpeg|gif|webp|webmanifest|txt|xml)$).*)",
  ],
};
