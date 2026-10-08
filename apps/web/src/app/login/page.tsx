import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/login-form";
import { LoginShowcase } from "@/components/auth/login-showcase";
import { BrandLogo } from "@/components/layout/brand-logo";
import { loginErrorMessage } from "@/lib/auth/login-errors";
import { afterLoginPath } from "@/lib/auth/routes";
import { SITE_NAME } from "@/lib/site";
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
  const params = await searchParams;
  // A repeated parameter counts by its first value, as in proxy.ts.
  const [next, error] = [params.next, params.error].map((value) =>
    Array.isArray(value) ? value[0] : value,
  );
  return (
    <div className="grid min-h-svh lg:min-h-[36rem] lg:grid-cols-2">
      <div className="flex flex-col p-6 md:p-10">
        <header>
          <BrandLogo variant="logotype" className="h-7 w-auto" />
        </header>
        <main className="flex flex-1 items-center justify-center py-10">
          <div className="flex w-full max-w-sm flex-col gap-6">
            <div className="flex flex-col gap-1 text-center">
              <h1 className="text-2xl font-semibold">Te damos la bienvenida</h1>
              <p className="text-sm text-muted-foreground">
                Entrá para ver tu patrimonio
              </p>
            </div>
            <LoginForm
              next={afterLoginPath(next)}
              error={loginErrorMessage(error)}
              googleEnabled={await googleEnabled()}
            />
          </div>
        </main>
        <footer className="text-xs text-muted-foreground">© {SITE_NAME}</footer>
      </div>
      <LoginShowcase />
    </div>
  );
}
