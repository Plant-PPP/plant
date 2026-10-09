"use client";

import { Check, Copy } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { CodeInput } from "@/components/auth/code-input";
import { Button } from "@/components/ui/button";
import {
  startEnrollment,
  TOTP_ALREADY_ON,
  verifyTotp,
  type TotpEnrollment,
} from "@/lib/auth/mfa-browser";
import { loginErrorPath } from "@/lib/auth/login-errors";
import { mfaErrorMessage } from "@/lib/auth/mfa-errors";
import { TOTP_CODE_LENGTH } from "@/lib/auth/otp-config";
import { qrDataUrl, withQrSvgViewBox } from "@/lib/auth/qr-svg";
import { failedOnEndedSession } from "@/lib/auth/session-state";
import { attempt, useAuthRequest } from "@/lib/auth/use-auth-request";
import { createClient } from "@/lib/supabase/client";
import { TotpHelpDialog } from "./totp-help-dialog";

// A retry on an ended session can only fail again, so the user signs in and
// comes back here.
function signInAgain() {
  window.location.assign(
    loginErrorPath("signed_out", window.location.pathname),
  );
}

// Clears abandoned attempts, enrolls, shows the QR and the setup key, and
// verifies the first code. onSuccess runs once the factor is verified and the
// session is aal2; onAlreadyOn when another tab had already turned it on.
export function TotpEnrollPanel({
  onSuccess,
  onAlreadyOn,
  onCancel,
}: {
  onSuccess: () => void;
  onAlreadyOn: () => void;
  onCancel: () => void;
}) {
  const codeId = useId();
  const [enrollment, setEnrollment] = useState<TotpEnrollment>();
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const { run, pending, error, setError } = useAuthRequest(mfaErrorMessage);

  const enroll = useCallback(async () => {
    const failure = await attempt(async () => {
      setEnrollment(await startEnrollment(createClient()));
      return null;
    });
    if (failedOnEndedSession(failure)) signInAgain();
    else if (failure?.code === TOTP_ALREADY_ON) onAlreadyOn();
    else if (failure) setError(mfaErrorMessage(failure));
  }, [setError, onAlreadyOn]);

  // Enroll once per mount. React's dev double effect would otherwise send two
  // enrolls, and the second removes the first's factor in the cleanup.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void enroll();
  }, [enroll]);

  function retry() {
    setError(undefined);
    void enroll();
  }

  // Without clipboard access the key stays on screen to select by hand.
  const copiedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  async function copySecret() {
    if (!enrollment) return;
    try {
      await navigator.clipboard.writeText(enrollment.secret);
    } catch {
      return;
    }
    setCopied(true);
    clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 2000);
  }

  async function verify() {
    if (!enrollment) return;
    const failure = await run(async () => {
      await verifyTotp(createClient(), enrollment.factorId, code);
      return null;
    });
    if (!failure) onSuccess();
    else if (failedOnEndedSession(failure)) signInAgain();
    else setCode("");
  }

  return (
    <div className="mx-auto grid w-full max-w-sm gap-4">
      {error && (
        <p role="alert" className="text-center text-sm text-destructive">
          {error}
        </p>
      )}
      {!enrollment ? (
        error ? (
          <Button
            type="button"
            variant="secondary"
            className="justify-self-center"
            onClick={retry}
          >
            Reintentar
          </Button>
        ) : (
          <p
            role="status"
            className="text-center text-sm text-muted-foreground"
          >
            Preparando la configuración…
          </p>
        )
      ) : (
        <>
          <p className="text-center text-sm text-muted-foreground text-balance">
            Escaneá el código con tu app de autenticación.
          </p>
          <div className="flex justify-center">
            {/* A white quiet zone: on a dark background phone cameras cannot
                read the code. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qrDataUrl(withQrSvgViewBox(enrollment.qrCode))}
              alt="Código QR para tu app de autenticación"
              className="size-52 rounded-lg bg-white p-3"
            />
          </div>
          <div className="flex flex-col items-center gap-2">
            <p className="text-center text-xs text-muted-foreground text-balance">
              ¿No podés escanearlo? Pegá esta clave en la app.
            </p>
            <div className="flex max-w-full items-center gap-1.5 rounded-full border bg-muted/50 py-1 pr-1 pl-4">
              <span className="font-mono text-xs tracking-wide break-all">
                {enrollment.secret}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 shrink-0 rounded-full"
                onClick={() => void copySecret()}
                aria-label="Copiar la clave"
              >
                {copied ? (
                  <Check className="size-3.5 text-primary" />
                ) : (
                  <Copy className="size-3.5" />
                )}
              </Button>
            </div>
          </div>
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void verify();
            }}
          >
            <div className="flex flex-col gap-1.5">
              <label htmlFor={codeId} className="text-sm font-medium">
                Código de la app
              </label>
              <CodeInput id={codeId} value={code} onChange={setCode} />
            </div>
            <Button
              type="submit"
              disabled={pending || code.length < TOTP_CODE_LENGTH}
            >
              Confirmar
            </Button>
          </form>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setHelpOpen(true)}
          >
            ¿No te funciona?
          </Button>
          <TotpHelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
        </>
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="justify-self-center"
        disabled={pending}
        onClick={onCancel}
      >
        Cancelar
      </Button>
    </div>
  );
}
