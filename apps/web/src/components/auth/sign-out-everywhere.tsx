"use client";

import { Button } from "@/components/ui/button";
import { loginErrorPath } from "@/lib/auth/login-errors";
import { LOGIN_PATH } from "@/lib/auth/routes";
import { signOutAndConfirm } from "@/lib/auth/sign-out";
import { type AuthFailure, useAuthRequest } from "@/lib/auth/use-auth-request";
import { createClient } from "@/lib/supabase/client";
import { signOutEverywhere } from "./sign-out-everywhere-steps";

const failureMessage = (failure: AuthFailure) =>
  failure.code === "this_device_failed"
    ? "Cerramos tus otras sesiones, pero no esta. Probá de nuevo."
    : "No pudimos cerrar tus otras sesiones. Probá de nuevo.";

// The way out of /auth/mfa for a user who lost the app or is on the wrong
// account: it also ends sessions a thief might hold.
export function SignOutEverywhere() {
  const { run, pending, error } = useAuthRequest(failureMessage);

  function signOut() {
    void run(async () => {
      const outcome = await signOutEverywhere(
        createClient().auth,
        signOutAndConfirm,
      );
      if (outcome === "done") window.location.assign(LOGIN_PATH);
      else if (outcome === "session_ended") {
        window.location.assign(loginErrorPath("session_ended"));
      } else return { code: outcome };
      return null;
    });
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <Button
        type="button"
        variant="link"
        size="sm"
        className="text-muted-foreground"
        disabled={pending}
        onClick={signOut}
      >
        Cerrar sesión en todos tus dispositivos
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
