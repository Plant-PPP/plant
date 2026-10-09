"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { LOGIN_PATH } from "@/lib/auth/routes";
import { signOutAndConfirm } from "@/lib/auth/sign-out";
import { createClient } from "@/lib/supabase/client";
import { signOutEverywhere } from "./sign-out-everywhere-steps";

// The way out of /auth/mfa for a user who lost the app or is on the wrong
// account: it also ends sessions a thief might hold.
export function SignOutEverywhere() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function signOut() {
    setPending(true);
    setError(undefined);
    const outcome = await signOutEverywhere(
      createClient().auth,
      signOutAndConfirm,
    );
    if (outcome === "done") {
      window.location.assign(LOGIN_PATH);
      return;
    }
    setPending(false);
    setError(
      outcome === "others_failed"
        ? "No pudimos cerrar tus otras sesiones. Probá de nuevo."
        : "Cerramos tus otras sesiones, pero no esta. Probá de nuevo.",
    );
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <Button
        type="button"
        variant="link"
        size="sm"
        className="text-muted-foreground"
        disabled={pending}
        onClick={() => void signOut()}
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
