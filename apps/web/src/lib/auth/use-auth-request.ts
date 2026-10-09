"use client";

import { useEffect, useState } from "react";

export type AuthFailure = { code?: string };

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
  ): Promise<boolean> {
    setPending(true);
    setError(undefined);
    const failure = await attempt(action);
    if (failure) {
      setPending(false);
      setError(toMessage(failure));
    }
    return !failure;
  }

  return { run, pending, setPending, error, setError };
}

// The action's failure, or null on success. A thrown error keeps its code, so
// a helper that throws Auth's error reads like one that returns it.
export async function attempt(
  action: () => Promise<AuthFailure | null>,
): Promise<AuthFailure | null> {
  try {
    return await action();
  } catch (thrown) {
    const code = (thrown as { code?: unknown } | null)?.code;
    return { code: typeof code === "string" ? code : undefined };
  }
}
