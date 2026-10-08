import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { AUTH_UNAVAILABLE_HEADER } from "@/lib/auth/session-state";
import { requireSupabaseEnv, SESSION_COOKIE_OPTIONS } from "./env";

// auth-js retries a refresh for up to 30 s while Auth answers 5xx or does not
// answer; past this the page shows the retry instead of hanging.
const AUTH_TIMEOUT_MS = 5000;

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
  const { data, error } = await Promise.race([
    supabase.auth.getClaims(),
    timeout,
  ]).finally(() => clearTimeout(timer));

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
