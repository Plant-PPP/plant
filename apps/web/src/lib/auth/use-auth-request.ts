"use client";

import { useEffect, useState } from "react";
import { errorType } from "@/lib/log/error-type";
import { reportClientError } from "@/lib/reports/client";

import type { MaybeAuthError } from "./session-state";

export type AuthFailure = NonNullable<MaybeAuthError>;

// One request to Auth at a time, with its error as Spanish copy. pending stays
// true after a success, so a second click cannot reuse a spent code; a caller
// that stays on the page resets it.
export function useAuthRequest(
  toMessage: (failure: AuthFailure) => string | undefined,
  initialError?: string,
) {
  const [error, setError] = useState(initialError);
  const [pending, setPending] = useState(false);

  // Back from another page can restore this one with the buttons still
  // disabled.
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) setPending(false);
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  async function run(
    action: () => Promise<AuthFailure | null>,
  ): Promise<AuthFailure | null> {
    setPending(true);
    setError(undefined);
    const failure = await attempt(action);
    if (failure) {
      setPending(false);
      setError(toMessage(failure));
    }
    return failure;
  }

  return { run, pending, setPending, error, setError };
}

// The action's failure, or null on success. A thrown error keeps its code and
// name, so a helper that throws Auth's error reads like one that returns it.
// A failure the user did not cause is reported to the server.
export async function attempt(
  action: () => Promise<AuthFailure | null>,
): Promise<AuthFailure | null> {
  let failure: AuthFailure | null;
  try {
    failure = await action();
  } catch (thrown) {
    const { code, name, status } = (thrown ?? {}) as {
      code?: unknown;
      name?: unknown;
      status?: unknown;
    };
    failure = {
      code: typeof code === "string" ? code : undefined,
      name: typeof name === "string" ? name : undefined,
      ...(typeof status === "number" ? { status } : {}),
    } as AuthFailure;
  }
  if (failure) reportAuthOutage(failure, "auth");
  return failure;
}

// The failures that say Auth is down or unreachable, by class: no answer, or
// an answer it could not read.
const UNREACHABLE = new Set(["AuthRetryableFetchError", "AuthUnknownError"]);

// Reports Auth being down or unreachable: a 5xx, or one of the classes above.
// A wrong or expired code, a rate limit, an ended session or the app's own
// refusal (TOTP already on) is the user's to act on and is not reported.
export function reportAuthOutage(
  failure: unknown,
  kind: "auth" | "settings",
): void {
  if (typeof failure !== "object" || failure === null) return;
  const { status, name } = failure as { status?: unknown; name?: unknown };
  const down = typeof status === "number" && status >= 500;
  if (!down && !(typeof name === "string" && UNREACHABLE.has(name))) return;
  reportClientError({
    kind,
    type: errorType(failure) ?? "unknown",
    ...(typeof status === "number" ? { status } : {}),
  });
}
