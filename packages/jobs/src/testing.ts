import { createHmac } from "node:crypto";

// Test-only helpers (exported as @plant/jobs/testing): modules that read env at
// import time are loaded fresh under a swapped process.env.

// Invented key in Inngest's format; never a real one.
export const TEST_SIGNING_KEY = `signkey-test-${"ab".repeat(32)}`;

const ORIGINAL_ENV = process.env;

export function loadWithEnv<T>(
  env: Record<string, string | undefined>,
  load: () => T,
): T {
  process.env = { ...ORIGINAL_ENV, ...env };
  let loaded!: T;
  jest.isolateModules(() => {
    loaded = load();
  });
  return loaded;
}

export function restoreEnv(): void {
  process.env = ORIGINAL_ENV;
}

// The x-inngest-signature header Inngest sends with a request body.
export function sign(body: string, key = TEST_SIGNING_KEY): string {
  const timestamp = Math.round(Date.now() / 1000).toString();
  const signature = createHmac("sha256", key.replace(/^signkey-\w+-/, ""))
    .update(body + timestamp)
    .digest("hex");
  return `t=${timestamp}&s=${signature}`;
}
