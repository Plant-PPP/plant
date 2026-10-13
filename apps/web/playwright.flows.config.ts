import { execFileSync } from "node:child_process";
import { defineConfig, devices } from "@playwright/test";

const PORT = 3101;

const notRunning =
  "Local Supabase is not running. Run: pnpm exec supabase start";

// The flows sign up users, and plant-staging is also production's database
// until the beta. The same guard as security-tests/src/local-stack.ts, copied:
// security-tests is a leaf no package may import, and a config-only helper
// does not earn a place in a shared package.
const localHosts = new Set(["127.0.0.1", "localhost"]);

function assertLocal(url: string) {
  if (!localHosts.has(new URL(url).hostname)) {
    throw new Error("The e2e flows run only against local Supabase");
  }
}

// The local stack's URL and anon key, read once: workers load this file again
// and inherit the runner's environment.
function pointAtLocalSupabase() {
  const { NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: key } =
    process.env;
  if (url && key) {
    assertLocal(url);
    return;
  }
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
  const { API_URL: apiUrl, ANON_KEY: anonKey } = status;
  if (typeof apiUrl !== "string" || typeof anonKey !== "string") {
    throw new Error(notRunning);
  }
  assertLocal(apiUrl);
  process.env.NEXT_PUBLIC_SUPABASE_URL = apiUrl;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = anonKey;
}

pointAtLocalSupabase();

// The main flows against local Supabase (Auth, PostgREST, Mailpit). A
// production build, which outside a Vercel production deployment serves the
// data pages over the browser-held prototype.
export default defineConfig({
  testDir: "e2e/flows",
  forbidOnly: !!process.env.CI,
  // Beside the CSP run's, which CI runs first in the same job.
  outputDir: "test-results/flows",
  reporter: process.env.CI
    ? [
        ["github"],
        ["html", { open: "never", outputFolder: "playwright-report/flows" }],
      ]
    : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
        },
      },
    },
  ],
  webServer: {
    command: `pnpm build && pnpm start -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    timeout: 180_000,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL!,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    },
  },
});
