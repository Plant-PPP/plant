import { execFileSync } from "node:child_process";
import { defineConfig, devices } from "@playwright/test";

const PORT = 3101;

// The local stack's URL and anon key, read once: workers load this file again
// and inherit the runner's environment.
function pointAtLocalSupabase() {
  if (
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    return;
  }
  const status = execFileSync(
    "pnpm",
    ["exec", "supabase", "status", "-o", "env"],
    {
      stdio: ["ignore", "pipe", "ignore"],
    },
  ).toString();
  const read = (name: string) => {
    const value = status.match(
      new RegExp(`^${name}="?([^"\\n]*)"?$`, "m"),
    )?.[1];
    if (!value) {
      throw new Error(
        `supabase status did not return ${name}; run pnpm exec supabase start`,
      );
    }
    return value;
  };
  process.env.NEXT_PUBLIC_SUPABASE_URL = read("API_URL");
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = read("ANON_KEY");
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
