// In dev mode Inngest checks no signature, so the local servers listen on
// loopback only: another device on the network could otherwise run the
// quotes job. The jobs package registers the app at the same origin.
//
//   pnpm test:scripts

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("next dev binds 127.0.0.1", () => {
  const { scripts } = JSON.parse(read("apps/web/package.json"));
  assert.match(scripts.dev, /^next dev .*-H 127\.0\.0\.1(\s|$)/);
});

test("the Inngest dev server binds 127.0.0.1 and calls the app there", () => {
  const command = read("scripts/setup/dev-up.sh")
    .split("\n")
    .find((line) => line.includes("inngest-cli dev"));
  assert.ok(command, "dev-up.sh runs inngest-cli dev");
  assert.match(command, /\s--host 127\.0\.0\.1(\s|")/);
  assert.match(command, /\s-u http:\/\/127\.0\.0\.1:3000\/api\/inngest(\s|")/);
});

test("the jobs package registers the app at the origin the dev server calls", () => {
  const [, origin] =
    /const DEV_SERVE_ORIGIN = "([^"]+)";/.exec(
      read("packages/jobs/src/index.ts"),
    ) ?? [];
  assert.equal(origin, "http://127.0.0.1:3000");
});
