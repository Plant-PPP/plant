import { type NextRequest, NextResponse } from "next/server";
import { loginErrorPath } from "@/lib/auth/login-errors";
import { afterLoginPath, NEXT_COOKIE } from "@/lib/auth/routes";
import {
  errorType,
  type LogFields,
  type LogLevel,
  serverLog,
} from "@/lib/log/server-log";
import {
  REQUEST_ID_FIELD,
  REQUEST_ID_HEADER,
  requestIdFrom,
} from "@/lib/request-id";
import { createClient } from "@/lib/supabase/server";

// Auth's error codes are snake_case; anything else in the param is not one.
const AUTH_ERROR_CODE = /^[a-z_]{1,64}$/;

// Google and the mail link land here with a PKCE code. The verifier is in the
// cookies of the browser that asked, so a link opened elsewhere fails.
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const next = afterLoginPath(request.cookies.get(NEXT_COOKIE.name)?.value);
  const code = searchParams.get("code");
  const errorCode = searchParams.get("error_code");
  const log = (
    level: Exclude<LogLevel, "error">,
    outcome: string,
    fields?: LogFields,
  ) =>
    serverLog[level]("auth.callback", {
      [REQUEST_ID_FIELD]: requestIdFrom(request.headers.get(REQUEST_ID_HEADER)),
      "plant.outcome": outcome,
      ...fields,
    });

  let target: string;
  if (errorCode === "otp_expired") {
    target = loginErrorPath("link_expired");
    log("info", "link_expired", { "plant.auth.reason": "otp_expired" });
  } else if (searchParams.has("error")) {
    target = loginErrorPath("oauth");
    // The user saying no on Google's screen arrives as access_denied with no
    // error_code, or with access_denied as the code; Auth's own refusals
    // (signup_disabled, user_banned) carry another code.
    const denied =
      searchParams.get("error") === "access_denied" &&
      (errorCode === null || errorCode === "access_denied");
    log(denied ? "info" : "warn", "oauth_error", {
      ...(denied
        ? { "plant.auth.reason": "access_denied" }
        : { "error.type": "_OTHER" }),
      "plant.auth.error_code":
        errorCode === null
          ? undefined
          : AUTH_ERROR_CODE.test(errorCode)
            ? errorCode
            : "other",
    });
  } else if (!code) {
    target = loginErrorPath("callback");
    log("warn", "missing_code", { "error.type": "missing_code" });
  } else {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      target = loginErrorPath("callback");
      log("warn", "exchange_failed", { "error.type": errorType(error) });
    } else {
      target = next;
      log("info", "signed_in", { "enduser.id": data.user.id });
    }
  }

  const res = NextResponse.redirect(new URL(target, request.url));
  res.cookies.delete({ name: NEXT_COOKIE.name, path: NEXT_COOKIE.path });
  // The session cookies ride on this response.
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}
