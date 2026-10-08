import { execFileSync } from "node:child_process";

export type LocalStack = {
  apiUrl: string;
  anonKey: string;
  serviceRoleKey: string;
};

// What the specs get; the service role key stays out of the specs.
export type PublicStack = Pick<LocalStack, "apiUrl" | "anonKey">;

const notRunning =
  "Local Supabase is not running. Run: pnpm exec supabase start";

// The specs create and delete users, and plant-staging is also production's
// database until the beta.
const localHosts = new Set(["127.0.0.1", "localhost"]);

export function readLocalStack(): LocalStack {
  let status: Record<string, unknown>;
  try {
    status = JSON.parse(
      execFileSync("pnpm", ["exec", "supabase", "status", "-o", "json"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
  } catch {
    // The CLI output carries the keys, so none of it goes into the error.
    throw new Error(notRunning);
  }
  const {
    API_URL: apiUrl,
    ANON_KEY: anonKey,
    SERVICE_ROLE_KEY: serviceRoleKey,
  } = status;
  if (
    typeof apiUrl !== "string" ||
    typeof anonKey !== "string" ||
    typeof serviceRoleKey !== "string"
  ) {
    throw new Error(notRunning);
  }
  if (!localHosts.has(new URL(apiUrl).hostname)) {
    throw new Error("Pentest specs run only against local Supabase");
  }
  return { apiUrl, anonKey, serviceRoleKey };
}
