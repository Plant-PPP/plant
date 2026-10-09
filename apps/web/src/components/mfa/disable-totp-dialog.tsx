"use client";

import { useId, useState } from "react";
import { disableTotp } from "@/app/(app)/settings/actions";
import { CONFIRM_DISABLE_PATH } from "@/components/settings/two-factor-status";
import { CodeInput } from "@/components/auth/code-input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormAlert } from "@/components/ui/form-alert";
import { verifyTotp } from "@/lib/auth/mfa-browser";
import type { DisableOutcome } from "@/lib/auth/mfa-disable";
import { mfaErrorMessage } from "@/lib/auth/mfa-errors";
import { TOTP_CODE_LENGTH } from "@/lib/auth/otp-config";
import { loginPath } from "@/lib/auth/routes";
import { failedOnEndedSession } from "@/lib/auth/session-state";
import { currentPath, signInAgain } from "@/lib/auth/sign-in-again";
import { SIGN_OUT_FAILED, signOutAndConfirm } from "@/lib/auth/sign-out";
import { useAuthRequest } from "@/lib/auth/use-auth-request";
import { settle } from "@/lib/server-action-call";
import { createClient } from "@/lib/supabase/client";

const RETRY = "No pudimos desactivarla. Probá de nuevo.";

// What the dialog does with each answer of the action: stay open for another
// code, or close and let the card reload the factors and show the notice.
const ANSWERS: Record<
  Exclude<DisableOutcome, "session_ended">,
  { close: boolean; copy: string }
> = {
  disabled: {
    close: true,
    copy: "Desactivaste la verificación en dos pasos.",
  },
  session_refresh_failed: {
    close: true,
    copy: "Desactivaste la verificación en dos pasos.",
  },
  partial: {
    close: true,
    copy: "Desactivamos parte de la verificación. Probá de nuevo.",
  },
  totp_stale: { close: false, copy: "El código venció. Probá de nuevo." },
  factor_not_found: {
    close: false,
    copy: "Tu app de autenticación cambió. Recargá la página y probá de nuevo.",
  },
  user_mismatch: { close: false, copy: RETRY },
  invalid_input: { close: false, copy: RETRY },
  error: { close: false, copy: RETRY },
};

// Turning TOTP off: a sign-in by mail or Google within the step-up window, then
// a current code. The server decides both; stepUp only saves typing a code the
// server would refuse.
export function DisableTotpDialog({
  open,
  onOpenChange,
  factorId,
  stepUp,
  onStepUp,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  factorId: string;
  stepUp: boolean;
  onStepUp: () => void;
  onDone: (notice: string) => void;
}) {
  const codeId = useId();
  const [code, setCode] = useState("");
  const { run, pending, setPending, error, setError } =
    useAuthRequest(mfaErrorMessage);

  async function stepUpSignIn() {
    setPending(true);
    setError(undefined);
    // The user menu also sends a signed-out tab to sign in and back to this
    // URL, so both land on the dialog.
    const url = currentPath();
    window.history.replaceState(null, "", CONFIRM_DISABLE_PATH);
    if (await signOutAndConfirm(createClient().auth)) {
      window.location.assign(loginPath(CONFIRM_DISABLE_PATH));
      return;
    }
    window.history.replaceState(null, "", url);
    setPending(false);
    setError(SIGN_OUT_FAILED);
  }

  async function disable() {
    const failure = await run(async () => {
      await verifyTotp(createClient(), factorId, code);
      return null;
    });
    if (failedOnEndedSession(failure)) return signInAgain();
    setCode("");
    if (failure) return;

    const result = await settle(disableTotp(factorId));
    if (result === "rejected") {
      setPending(false);
      setError(RETRY);
      return;
    }
    if ("stepUp" in result) {
      setPending(false);
      onStepUp();
      return;
    }
    if (result.outcome === "session_ended") return signInAgain();
    const answer = ANSWERS[result.outcome];
    if (answer.close) return onDone(answer.copy);
    setPending(false);
    setError(answer.copy);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Desactivar la verificación en dos pasos</DialogTitle>
          <DialogDescription>
            {stepUp
              ? "Por seguridad, volvé a ingresar. Vamos a cerrar tu sesión en este dispositivo."
              : "Ingresá el código que muestra tu app de autenticación."}
          </DialogDescription>
        </DialogHeader>
        {error && <FormAlert>{error}</FormAlert>}
        {stepUp ? (
          <DialogFooter>
            <Button
              type="button"
              disabled={pending}
              onClick={() => void stepUpSignIn()}
            >
              Volver a ingresar
            </Button>
          </DialogFooter>
        ) : (
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void disable();
            }}
          >
            <div className="flex flex-col gap-1.5">
              <label htmlFor={codeId} className="text-sm font-medium">
                Código de la app
              </label>
              <CodeInput id={codeId} value={code} onChange={setCode} />
            </div>
            <DialogFooter>
              <Button
                type="submit"
                variant="destructive"
                disabled={pending || code.length < TOTP_CODE_LENGTH}
              >
                Desactivar
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
