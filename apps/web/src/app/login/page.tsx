import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/login-form";
import { BrandLogo } from "@/components/layout/brand-logo";
import { loginErrorMessage } from "@/lib/auth/login-errors";
import { sanitizeNextPath } from "@/lib/auth/safe-redirect";
import { requireSupabaseEnv } from "@/lib/supabase/env";

export const metadata: Metadata = { title: "Ingresar" };

// Hides the button only when Auth says Google is off; if it can't tell, the
// button stays and a failure shows up as the oauth error.
async function googleEnabled(): Promise<boolean> {
  const env = requireSupabaseEnv();
  try {
    const res = await fetch(`${env.url}/auth/v1/settings`, {
      headers: { apikey: env.anonKey },
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return true;
    const settings = (await res.json()) as { external?: { google?: unknown } };
    return settings.external?.google !== false;
  } catch {
    return true;
  }
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { next, error } = await searchParams;
  return (
    <main className="flex min-h-svh flex-col items-center justify-center p-6">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <BrandLogo variant="logotype" className="h-8 w-auto" />
        <h1 className="text-xl font-semibold">Entrá a Plant</h1>
        <LoginForm
          next={sanitizeNextPath(next)}
          error={loginErrorMessage(error)}
          googleEnabled={await googleEnabled()}
        />
      </div>
    </main>
  );
}
