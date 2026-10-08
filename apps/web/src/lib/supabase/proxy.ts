import { createServerClient } from "@supabase/ssr";
import { AuthInvalidJwtError } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";
import { AUTH_UNAVAILABLE_HEADER } from "@/lib/auth/session-state";
import { requireSupabaseEnv, SESSION_COOKIE_OPTIONS } from "./env";

// auth-js retries a refresh for up to 30 s on a 5xx or a failed fetch, and a
// request Auth never answers has no timeout of its own; past this the page
// shows the retry.
const AUTH_TIMEOUT_MS = 5000;
// auth-js refreshes a token within EXPIRY_MARGIN_MS (90 s) of expiry wherever
// it runs. Refreshing here from 120 s keeps a Server Component, which cannot
// save the rotated cookies, from refreshing in the same request; jwt_expiry
// must stay well above it. If Auth fails here, the page shows the retry even
// though the token still works for up to 120 s.
const REFRESH_AHEAD_MS = 120_000;

function withoutUnavailable(headers: Headers): Headers {
  const copy = new Headers(headers);
  copy.delete(AUTH_UNAVAILABLE_HEADER);
  return copy;
}

// The request/response cookie adapter for proxy.ts. server.ts goes through
// cookies(), which can neither rebuild NextResponse.next({ request }) with
// refreshed cookies nor set the no-cache headers Supabase sends with them.
export async function updateSession(request: NextRequest) {
  // The headers as they arrived, before a refresh rewrites the cookies, minus
  // any copy of the header only proxy.ts may set.
  const original = withoutUnavailable(request.headers);
  const forward = () =>
    NextResponse.next({
      request: { headers: withoutUnavailable(request.headers) },
    });

  const env = requireSupabaseEnv();
  let response = forward();
  const cacheHeaders = new Headers();
  // Whether the last cookie write carried a new session rather than deletions.
  let refreshed = false;

  const supabase = createServerClient(env.url, env.anonKey, {
    cookieOptions: SESSION_COOKIE_OPTIONS,
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        refreshed = cookiesToSet.some(({ value }) => value !== "");
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = forward();
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        for (const [key, value] of Object.entries(headers)) {
          cacheHeaders.set(key, value);
          response.headers.set(key, value);
        }
      },
    },
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ data: null; error: Error }>((resolve) => {
    timer = setTimeout(
      () => resolve({ data: null, error: new Error("Auth timed out") }),
      AUTH_TIMEOUT_MS,
    );
  });
  // getClaims and refreshSession return Auth's failures and throw only on a
  // token they cannot decode or verify (a corrupted or planted cookie). That
  // is no session, so the visitor goes to /login, which replaces it.
  const claims = (async () => {
    const first = await supabase.auth.getClaims();
    const exp = first.data?.claims.exp;
    if (exp === undefined || exp * 1000 - Date.now() >= REFRESH_AHEAD_MS) {
      return first;
    }
    const { error } = await supabase.auth.refreshSession();
    return error ? { data: null, error } : supabase.auth.getClaims();
  })().catch(() => ({
    data: null,
    error: new AuthInvalidJwtError("Invalid JWT"),
  }));
  const { data, error } = await Promise.race([claims, timeout]).finally(() =>
    clearTimeout(timer),
  );

  return {
    claims: data?.claims ?? null,
    error,
    response: () => response,
    // A redirect that keeps the refreshed cookies and their cache headers.
    redirect(url: URL) {
      return withRefresh(NextResponse.redirect(url));
    },
    // Auth failed after or instead of a refresh. The page gets the header that
    // makes it show the retry; deletions from the failure are dropped, but a
    // refresh that succeeded is kept, because Auth already rotated the old
    // refresh token.
    unavailable() {
      const headers = refreshed
        ? withoutUnavailable(request.headers)
        : new Headers(original);
      headers.set(AUTH_UNAVAILABLE_HEADER, "unavailable");
      const forwarded = NextResponse.next({ request: { headers } });
      return refreshed ? withRefresh(forwarded) : forwarded;
    },
  };

  function withRefresh(target: NextResponse): NextResponse {
    for (const cookie of response.cookies.getAll()) {
      target.cookies.set(cookie);
    }
    cacheHeaders.forEach((value, key) => target.headers.set(key, value));
    return target;
  }
}
