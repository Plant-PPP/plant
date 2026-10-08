import { type NextRequest, NextResponse } from "next/server";
import { loginErrorPath } from "@/lib/auth/login-errors";
import { NEXT_COOKIE } from "@/lib/auth/routes";
import { sanitizeNextPath } from "@/lib/auth/safe-redirect";
import { createClient } from "@/lib/supabase/server";

// Google and the mail link land here with a PKCE code. The verifier is in the
// cookies of the browser that asked, so a link opened elsewhere fails.
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const next = sanitizeNextPath(request.cookies.get(NEXT_COOKIE.name)?.value);
  const code = searchParams.get("code");

  let target: string;
  if (searchParams.get("error_code") === "otp_expired") {
    target = loginErrorPath("link_expired");
  } else if (searchParams.has("error")) {
    target = loginErrorPath("oauth");
  } else if (!code) {
    target = loginErrorPath("callback");
  } else {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    target = error ? loginErrorPath("callback") : next;
  }

  const res = NextResponse.redirect(new URL(target, request.url));
  res.cookies.delete({ name: NEXT_COOKIE.name, path: NEXT_COOKIE.path });
  // The session cookies ride on this response.
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}
