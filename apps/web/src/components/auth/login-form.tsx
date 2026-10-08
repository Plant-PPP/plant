"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authErrorSlug, loginErrorMessage } from "@/lib/auth/login-errors";
import { OTP_LENGTH, RESEND_COOLDOWN_SECONDS } from "@/lib/auth/otp-config";
import { CALLBACK_PATH, NEXT_COOKIE } from "@/lib/auth/routes";
import { sanitizeAuthCode } from "@/lib/auth/sanitize-auth-code";
import { createClient } from "@/lib/supabase/client";

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
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState(initialError);
  const [pending, setPending] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  // The callback reads where to go from this cookie (Google, mail link).
  function rememberNext() {
    const secure = location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${NEXT_COOKIE.name}=${encodeURIComponent(next)}; Path=${NEXT_COOKIE.path}; Max-Age=${NEXT_COOKIE.maxAge}; SameSite=${NEXT_COOKIE.sameSite}${secure}`;
  }

  async function run(action: () => Promise<{ code?: string } | null>) {
    setPending(true);
    setError(undefined);
    const failure = await action();
    setPending(false);
    if (failure) setError(loginErrorMessage(authErrorSlug(failure)));
    return !failure;
  }

  async function sendCode() {
    const sent = await run(async () => {
      rememberNext();
      const { error } = await createClient().auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: true,
          emailRedirectTo: location.origin + CALLBACK_PATH,
        },
      });
      return error;
    });
    if (sent) {
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
      router.replace(next);
      router.refresh();
    }
  }

  async function signInWithGoogle() {
    await run(async () => {
      rememberNext();
      const { error } = await createClient().auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: location.origin + CALLBACK_PATH },
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
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <Button type="submit" disabled={pending}>
              Recibir código
            </Button>
          </form>
          {googleEnabled && (
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => void signInWithGoogle()}
            >
              Continuar con Google
            </Button>
          )}
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
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Código
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={OTP_LENGTH}
              required
              autoFocus
              value={code}
              onChange={(event) =>
                setCode(sanitizeAuthCode(event.target.value))
              }
              className="font-mono tracking-widest"
            />
          </label>
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
