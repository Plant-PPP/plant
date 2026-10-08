import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { AUTH_UNAVAILABLE_HEADER } from "@/lib/auth/session-state";
import { requireSupabaseEnv, SESSION_COOKIE_OPTIONS } from "./env";

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

  const supabase = createServerClient(env.url, env.anonKey, {
    cookieOptions: SESSION_COOKIE_OPTIONS,
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
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

  const { data, error } = await supabase.auth.getClaims();

  return {
    claims: data?.claims ?? null,
    error,
    response: () => response,
    original,
    // A redirect that keeps the refreshed cookies and their cache headers.
    redirect(url: URL) {
      const redirect = NextResponse.redirect(url);
      for (const cookie of response.cookies.getAll()) {
        redirect.cookies.set(cookie);
      }
      cacheHeaders.forEach((value, key) => redirect.headers.set(key, value));
      return redirect;
    },
  };
}
