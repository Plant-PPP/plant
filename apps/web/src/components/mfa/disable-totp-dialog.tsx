"use client";

import { useId, useState } from "react";
import { disableTotp } from "@/app/(app)/settings/actions";
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
import { verifyTotp } from "@/lib/auth/mfa-browser";
import type { DisableOutcome } from "@/lib/auth/mfa-disable";
import { mfaErrorMessage } from "@/lib/auth/mfa-errors";
import { TOTP_CODE_LENGTH } from "@/lib/auth/otp-config";
import { loginPath } from "@/lib/auth/routes";
import { failedOnEndedSession } from "@/lib/auth/session-state";
import { signInAgain } from "@/lib/auth/sign-in-again";
import { signOutAndConfirm } from "@/lib/auth/sign-out";
import { useAuthRequest } from "@/lib/auth/use-auth-request";
import { createClient } from "@/lib/supabase/client";

// Where the step-up's sign-in comes back to: Ajustes with this dialog open.
const CONFIRM_DISABLE_PATH = "/settings?confirm=disable";

const RETRY = "No pudimos desactivarla. Probá de nuevo.";

// Outcomes that keep the dialog open for another code.
const RETRY_MESSAGES: Partial<Record<DisableOutcome, string>> = {
  totp_stale: "El código venció. Probá de nuevo.",
  factor_not_found: "Recargá la página y probá de nuevo.",
  user_mismatch: RETRY,
  invalid_input: RETRY,
  error: RETRY,
};

// Outcomes after which the factors changed: the card reloads and says how.
const DONE_NOTICES: Partial<Record<DisableOutcome, string>> = {
  disabled: "Desactivaste la verificación en dos pasos.",
  session_refresh_failed: "Desactivamos la verificación. Recargá la página.",
  partial:
    "Desactivamos parte de la verificación. Recargá la página y probá de nuevo.",
};

// Turning TOTP off: a sign-in with the mailbox in the last 15 minutes, then a
// current code. The server decides both; stepUpNeeded only saves typing a code
// the server would refuse.
export function DisableTotpDialog({
  open,
  onOpenChange,
  factorId,
  stepUpNeeded,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  factorId: string;
  stepUpNeeded: boolean;
  onDone: (notice: string) => void;
}) {
  const codeId = useId();
  const [code, setCode] = useState("");
  const [stepUp, setStepUp] = useState(stepUpNeeded);
  const { run, pending, setPending, error, setError } =
    useAuthRequest(mfaErrorMessage);

  async function signInWithMail() {
    setPending(true);
    setError(undefined);
    if (await signOutAndConfirm(createClient().auth)) {
      window.location.assign(loginPath(CONFIRM_DISABLE_PATH));
      return;
    }
    setPending(false);
    setError("No pudimos cerrar la sesión. Probá de nuevo.");
  }

  async function disable() {
    const failure = await run(async () => {
      await verifyTotp(createClient(), factorId, code);
      return null;
    });
    if (failedOnEndedSession(failure)) return signInAgain();
    setCode("");
    if (failure) return;

    let result: Awaited<ReturnType<typeof disableTotp>>;
    try {
      result = await disableTotp(factorId);
    } catch {
      setPending(false);
      setError(RETRY);
      return;
    }
    if ("stepUp" in result) {
      setPending(false);
      setStepUp(true);
      return;
    }
    if (result.outcome === "session_ended") return signInAgain();
    const notice = DONE_NOTICES[result.outcome];
    if (notice) return onDone(notice);
    setPending(false);
    setError(RETRY_MESSAGES[result.outcome] ?? RETRY);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Desactivar la verificación en dos pasos</DialogTitle>
          <DialogDescription>
            {stepUp
              ? "Por seguridad, volvé a ingresar con tu mail. Vamos a cerrar tu sesión en este dispositivo y te mandamos un código o un enlace."
              : "Ingresá el código que muestra tu app de autenticación."}
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {stepUp ? (
          <DialogFooter>
            <Button
              type="button"
              disabled={pending}
              onClick={() => void signInWithMail()}
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
