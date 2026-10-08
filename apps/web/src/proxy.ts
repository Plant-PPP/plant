import { type NextRequest, NextResponse } from "next/server";
import { isPublicPath, LOGIN_PATH, loginPath } from "@/lib/auth/routes";
import { sanitizeNextPath } from "@/lib/auth/safe-redirect";
import {
  AUTH_UNAVAILABLE_HEADER,
  isSessionMissing,
} from "@/lib/auth/session-state";
import { supabaseEnv } from "@/lib/supabase/env";
import { updateSession } from "@/lib/supabase/proxy";

// Refreshes the session on every page request and sends anyone without one
// to /login. Server Components cannot write cookies, so this is where an
// expired access token is exchanged.
export async function proxy(request: NextRequest) {
  // Without Supabase the layout's own check fails and shows the error page.
  if (!supabaseEnv()) return NextResponse.next();

  const { pathname, search, searchParams } = request.nextUrl;
  const session = await updateSession(request);

  if (session.claims) {
    // A signed-in user on /login goes where they were headed, unless /login
    // is showing an error from the callback.
    if (pathname === LOGIN_PATH && !searchParams.has("error")) {
      return session.redirect(
        new URL(sanitizeNextPath(searchParams.get("next")), request.url),
      );
    }
    return session.response();
  }

  if (isSessionMissing(session.error)) {
    if (isPublicPath(pathname)) return session.response();
    return session.redirect(new URL(loginPath(pathname + search), request.url));
  }

  // Auth is unavailable (rate limit, conflict, outage). Forward the request
  // as it arrived, so a failed refresh deletes no cookie, and let the page
  // show the retry.
  session.original.set(AUTH_UNAVAILABLE_HEADER, "unavailable");
  return NextResponse.next({ request: { headers: session.original } });
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|api/inngest(?:/|$)|.*\\.(?:ico|png|svg|jpg|jpeg|gif|webp|webmanifest|txt|xml)$).*)",
  ],
};
