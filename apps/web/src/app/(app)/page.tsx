import type { Metadata } from "next";
import { navTitle } from "@/lib/navigation";
import { supabaseEnv } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: navTitle("/") };

async function supabaseStatus(): Promise<string> {
  const env = supabaseEnv();
  if (!env) return "Not configured: run pnpm env:local";
  try {
    const res = await fetch(`${env.url}/auth/v1/health`, {
      headers: { apikey: env.anonKey },
      cache: "no-store",
      signal: AbortSignal.timeout(2000),
    });
    return res.ok ? "Connected" : `Responded ${res.status}`;
  } catch {
    return "Not responding: did you run supabase start?";
  }
}

export default async function Home() {
  // The connection check is a dev aid; production does not expose it.
  const status =
    process.env.VERCEL_ENV === "production" ? null : await supabaseStatus();

  return (
    <div>
      <h1 className="sr-only">{navTitle("/")}</h1>
      <p className="text-sm text-muted-foreground">
        Acá vas a ver tu patrimonio en pesos y en dólares.
      </p>
      {status && (
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Supabase</dt>
          <dd>{status}</dd>
        </dl>
      )}
    </div>
  );
}
