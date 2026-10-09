"use client";

import { useId, useState } from "react";
import { CodeInput } from "@/components/auth/code-input";
import { Button } from "@/components/ui/button";
import { verifyTotp } from "@/lib/auth/mfa-browser";
import { mfaErrorMessage } from "@/lib/auth/mfa-errors";
import { TOTP_CODE_LENGTH } from "@/lib/auth/otp-config";
import { loginErrorPath } from "@/lib/auth/login-errors";
import { failedOnEndedSession } from "@/lib/auth/session-state";
import { attempt, useAuthRequest } from "@/lib/auth/use-auth-request";
import { createClient } from "@/lib/supabase/client";

export function MfaChallengeForm({
  factorId,
  next,
}: {
  factorId: string;
  next: string;
}) {
  const codeId = useId();
  const [code, setCode] = useState("");
  const { run, pending, error } = useAuthRequest(mfaErrorMessage);

  async function verify() {
    let ended = false;
    const verified = await run(async () => {
      const failure = await attempt(async () => {
        await verifyTotp(createClient(), factorId, code);
        return null;
      });
      // Another device's verify, or a timeout, ended this session.
      ended = failedOnEndedSession(failure);
      return failure;
    });
    // A full load, so the proxy and the server read the aal2 session instead
    // of claims or a prefetch cached at aal1.
    if (verified) window.location.assign(next);
    else if (ended) window.location.assign(loginErrorPath("signed_out", next));
    else setCode("");
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void verify();
      }}
    >
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-col gap-1.5">
        <label htmlFor={codeId} className="text-sm font-medium">
          Código
        </label>
        <CodeInput id={codeId} value={code} onChange={setCode} />
      </div>
      <Button
        type="submit"
        disabled={pending || code.length < TOTP_CODE_LENGTH}
      >
        Verificar
      </Button>
    </form>
  );
}
