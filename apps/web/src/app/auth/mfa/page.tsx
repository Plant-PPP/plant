import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { SignOutEverywhere } from "@/components/auth/sign-out-everywhere";
import { MfaChallengeForm } from "@/components/mfa/mfa-challenge-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { loginErrorPath } from "@/lib/auth/login-errors";
import { listVerifiedFactors } from "@/lib/auth/mfa-factors";
import { mfaRequirement } from "@/lib/auth/mfa-rules";
import { afterLoginPath, firstParam } from "@/lib/auth/routes";
import { readSessionClaims } from "@/lib/auth/session-claims-unchecked";
import {
  isSessionMissing,
  type MaybeAuthError,
} from "@/lib/auth/session-state";
import { serverLog } from "@/lib/log/server-log";
import {
  REQUEST_ID_FIELD,
  REQUEST_ID_HEADER,
  requestIdFrom,
} from "@/lib/request-id";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Verificación" };

const PROBLEMS = {
  no_totp_factor: "No encontramos tu app de autenticación.",
  factors_unavailable: "No pudimos cargar tu verificación. Recargá la página.",
} as const;

// The only page an enrolled session below aal2 may open. It reads claims
// without the MFA redirect, so it defines no server action and imports none.
export default async function MfaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const claims = await readSessionClaims();
  const next = afterLoginPath(firstParam((await searchParams).next));
  if (mfaRequirement(claims) === "met") redirect(next);

  let factorId: string | undefined;
  let problem: keyof typeof PROBLEMS | "session_ended" | undefined;
  try {
    const { totp } = await listVerifiedFactors(await createClient());
    factorId = totp[0]?.id;
    if (!factorId) problem = "no_totp_factor";
  } catch (error) {
    // A token still in date for a session that has ended: claims verify it
    // without asking Auth, the factor list does ask.
    if (isSessionMissing(error as MaybeAuthError)) {
      problem = "session_ended";
    } else {
      problem = "factors_unavailable";
      serverLog.error(
        "auth.mfa_page",
        await logFields(claims.sub, problem),
        error,
      );
    }
  }
  if (problem === "no_totp_factor" || problem === "session_ended") {
    serverLog.warn("auth.mfa_page", await logFields(claims.sub, problem));
  }
  if (problem === "session_ended") redirect(loginErrorPath("signed_out", next));

  return (
    <AuthShell>
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">
            <h1>Verificación en dos pasos</h1>
          </CardTitle>
          <CardDescription>
            Ingresá el código de 6 dígitos de tu app de autenticación.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {factorId ? (
            <MfaChallengeForm factorId={factorId} next={next} />
          ) : (
            <p role="alert" className="text-sm text-destructive">
              {PROBLEMS[problem ?? "factors_unavailable"]}
            </p>
          )}
        </CardContent>
      </Card>
      <SignOutEverywhere />
    </AuthShell>
  );
}

async function logFields(userId: string, outcome: string) {
  return {
    [REQUEST_ID_FIELD]: requestIdFrom((await headers()).get(REQUEST_ID_HEADER)),
    "enduser.id": userId,
    "plant.outcome": outcome,
  };
}
