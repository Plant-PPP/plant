import { supabaseEnv } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

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
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold">Plant</h1>
      <p className="text-sm text-zinc-500">
        Todo tu patrimonio, en pesos y en dólares.
      </p>
      {status && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-zinc-500">Supabase</dt>
          <dd>{status}</dd>
        </dl>
      )}
    </main>
  );
}
