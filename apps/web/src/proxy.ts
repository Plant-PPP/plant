import { type NextRequest, NextResponse } from "next/server";
import {
  afterLoginPath,
  isPublicPath,
  LOGIN_PATH,
  loginPath,
} from "@/lib/auth/routes";
import { loginErrorMessage } from "@/lib/auth/login-errors";
import {
  authErrorType,
  isSessionMissing,
  type MaybeAuthError,
} from "@/lib/auth/session-state";
import { buildCsp, createNonce, CSP_HEADER, NONCE_HEADER } from "@/lib/csp";
import { type LogLevel, serverLog } from "@/lib/log/server-log";
import {
  createRequestId,
  REQUEST_ID_FIELD,
  REQUEST_ID_HEADER,
} from "@/lib/request-id";
import { supabaseEnv, supabaseOrigins } from "@/lib/supabase/env";
import { updateSession } from "@/lib/supabase/proxy";

// Every page gets a CSP with a fresh nonce and a request id. Both go on the
// request too: Next reads the nonce from the request's CSP and stamps its
// own scripts, and the root layout passes it to next-themes. `set` replaces
// any copy the client sent. Each request logs one `proxy.request` line.
export async function proxy(request: NextRequest) {
  const nonce = createNonce();
  const requestId = createRequestId();
  const fields = {
    [REQUEST_ID_FIELD]: requestId,
    "http.request.method": request.method,
    "url.path": request.nextUrl.pathname,
  };
  // In Next 16.4 only an edge proxy reaches onRequestError, so a throw here
  // is logged here; onRequestError skips the proxy if that changes.
  try {
    const env = supabaseEnv();
    const csp = buildCsp({
      nonce,
      connectOrigins: env ? supabaseOrigins(env.url) : [],
      dev: process.env.NODE_ENV === "development",
    });
    request.headers.set(CSP_HEADER, csp);
    request.headers.set(NONCE_HEADER, nonce);
    request.headers.set(REQUEST_ID_HEADER, requestId);

    const session = await sessionResponse(request);
    session.response.headers.set(CSP_HEADER, csp);
    session.response.headers.set(REQUEST_ID_HEADER, requestId);
    // `error.type` only when Auth failed: a missing or broken session is the
    // proxy doing its job, and its code is the reason.
    const authError = authErrorType(session.authError);
    serverLog[LOG_LEVEL[session.outcome]]("proxy.request", {
      ...fields,
      "plant.outcome": session.outcome,
      "plant.auth.duration_ms": session.authDurationMs,
      "enduser.id": session.userId,
      ...(session.outcome === "auth_unavailable"
        ? { "error.type": authError }
        : { "plant.auth.reason": authError }),
    });
    return session.response;
  } catch (error) {
    serverLog.error(
      "proxy.request",
      { ...fields, "plant.outcome": "error" },
      error,
    );
    throw error;
  }
}

type SessionOutcome =
  | "no_auth_config"
  | "signed_in"
  | "redirect_signed_in"
  | "anonymous"
  | "redirect_login"
  | "auth_unavailable";

const LOG_LEVEL = {
  no_auth_config: "error",
  signed_in: "info",
  redirect_signed_in: "info",
  anonymous: "info",
  redirect_login: "info",
  auth_unavailable: "warn",
} as const satisfies Record<SessionOutcome, LogLevel>;

type SessionResult = {
  response: NextResponse;
  outcome: SessionOutcome;
  authDurationMs?: number;
  userId?: string;
  authError?: MaybeAuthError;
};

// Checks the session on every page request, refreshes it before it nears
// expiry and sends anyone without one to /login. Server Components cannot
// write cookies, so the exchange happens here.
async function sessionResponse(request: NextRequest): Promise<SessionResult> {
  // Without Supabase the layout's own check fails and shows the error page.
  if (!supabaseEnv()) {
    return {
      response: NextResponse.next({ request: { headers: request.headers } }),
      outcome: "no_auth_config",
    };
  }

  const { pathname, search, searchParams } = request.nextUrl;
  const started = performance.now();
  const session = await updateSession(request);
  const timing = {
    authDurationMs: Math.round(performance.now() - started),
    authError: session.error,
  };

  if (session.claims) {
    const signedIn = { ...timing, userId: session.claims.sub };
    // A signed-in user on /login goes where they were headed, unless /login
    // is showing a sign-in error.
    if (
      pathname === LOGIN_PATH &&
      !loginErrorMessage(searchParams.get("error"))
    ) {
      return {
        ...signedIn,
        response: session.redirect(
          new URL(afterLoginPath(searchParams.get("next")), request.url),
        ),
        outcome: "redirect_signed_in",
      };
    }
    return { ...signedIn, response: session.response(), outcome: "signed_in" };
  }

  if (isSessionMissing(session.error)) {
    if (isPublicPath(pathname)) {
      return { ...timing, response: session.response(), outcome: "anonymous" };
    }
    return {
      ...timing,
      response: session.redirect(
        new URL(loginPath(pathname + search), request.url),
      ),
      outcome: "redirect_login",
    };
  }

  // Auth is unavailable (rate limit, conflict, outage, timeout): a failed
  // refresh deletes no cookie, and the page shows the retry.
  return {
    ...timing,
    response: session.unavailable(),
    outcome: "auth_unavailable",
  };
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|api/inngest(?:/|$)|.*\\.(?:ico|png|svg|jpg|jpeg|gif|webp|webmanifest|txt|xml)$).*)",
  ],
};
