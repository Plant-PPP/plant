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

// Without a port of its own, next dev moves to 3001 when 3000 is taken, while
// the app still registers at 3000 and the dev server still calls 3000: the
// quotes job would run against whatever else listens there.
test("next dev fails rather than leave the port it registers", () => {
  const { scripts } = JSON.parse(read("apps/web/package.json"));
  assert.match(scripts.dev, /\s(-p|--port) 3000(\s|$)/);
});

test("dev-up.sh starts the web app through its pinned dev script", () => {
  const web = read("scripts/setup/dev-up.sh")
    .split("\n")
    .filter((line) => /next dev|@plant\/web/.test(line));
  assert.deepEqual(web, ['  "pnpm --filter @plant/web dev" \\']);
});
