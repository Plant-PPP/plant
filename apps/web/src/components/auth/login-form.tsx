"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { CodeInput } from "./code-input";
import { authErrorSlug, loginErrorMessage } from "@/lib/auth/login-errors";
import { OTP_LENGTH, RESEND_COOLDOWN_SECONDS } from "@/lib/auth/otp-config";
import { CALLBACK_PATH, NEXT_COOKIE } from "@/lib/auth/routes";
import { useAuthRequest, type AuthFailure } from "@/lib/auth/use-auth-request";
import { createClient } from "@/lib/supabase/client";

// The only redirect the Auth allow-list holds, for mail links and Google.
const callbackUrl = () => location.origin + CALLBACK_PATH;

const loginFailureMessage = (failure: AuthFailure) =>
  loginErrorMessage(authErrorSlug(failure));

// The browser calls Auth directly, so its rate limits count per visitor and
// not per server.
export function LoginForm({
  next,
  error: initialError,
  googleEnabled,
}: {
  next: string;
  error?: string;
  googleEnabled: boolean;
}) {
  const router = useRouter();
  const codeId = useId();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const { run, pending, setPending, error, setError } = useAuthRequest(
    loginFailureMessage,
    initialError,
  );
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  function writeNextCookie(value: string, maxAge: number) {
    const secure = location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${NEXT_COOKIE.name}=${value}; Path=${NEXT_COOKIE.path}; Max-Age=${maxAge}; SameSite=${NEXT_COOKIE.sameSite}${secure}`;
  }

  function rememberNext() {
    writeNextCookie(encodeURIComponent(next), NEXT_COOKIE.maxAge);
  }

  async function sendCode() {
    const sent = await run(async () => {
      rememberNext();
      const { error } = await createClient().auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: true,
          emailRedirectTo: callbackUrl(),
        },
      });
      return error;
    });
    if (sent) {
      setPending(false);
      setStep("code");
      setCode("");
      setCooldown(RESEND_COOLDOWN_SECONDS);
    }
  }

  async function verifyCode() {
    const verified = await run(async () => {
      const { error } = await createClient().auth.verifyOtp({
        email,
        token: code,
        type: "email",
      });
      return error;
    });
    if (verified) {
      // A later mail link opened in this browser must not land on this `next`.
      writeNextCookie("", 0);
      router.replace(next);
      router.refresh();
    }
  }

  async function signInWithGoogle() {
    await run(async () => {
      rememberNext();
      const { error } = await createClient().auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: callbackUrl() },
      });
      return error;
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {step === "email" ? (
        <>
          {googleEnabled && (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => void signInWithGoogle()}
              >
                <GoogleIcon />
                Continuar con Google
              </Button>
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <Separator className="flex-1" />o seguí con tu mail
                <Separator className="flex-1" />
              </div>
            </>
          )}
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void sendCode();
            }}
          >
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Mail
              <Input
                type="email"
                autoComplete="email"
                placeholder="nombre@ejemplo.com"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <Button type="submit" disabled={pending}>
              Recibir código
            </Button>
          </form>
        </>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void verifyCode();
          }}
        >
          <p className="text-sm text-muted-foreground">
            Te mandamos un código a {email}
          </p>
          {/* Not wrapped: the boxes show the digits, which would join the
              field's name. */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor={codeId} className="text-sm font-medium">
              Código
            </label>
            <CodeInput id={codeId} value={code} onChange={setCode} />
          </div>
          <Button type="submit" disabled={pending || code.length < OTP_LENGTH}>
            Entrar
          </Button>
          <div className="flex justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending || cooldown > 0}
              onClick={() => void sendCode()}
            >
              {cooldown > 0
                ? `Reenviar código (${cooldown})`
                : "Reenviar código"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => {
                setStep("email");
                setError(undefined);
              }}
            >
              Usar otro mail
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}
