// The money ban (eslint.money.mjs) reaches every lint config that uses it: a
// package's own rule options replace the shared ones, so a local
// `no-restricted-properties` can drop it.
//
//   pnpm test:scripts

import { strict as assert } from "node:assert";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const WORKSPACES = [
  "apps/web",
  "packages/core",
  "packages/jobs",
  "packages/shared",
  "packages/sources",
  "security-tests",
];
const FLOATS = [
  'export const x = parseFloat("1.5");',
  'export const x = Number.parseFloat("1.5");',
  'export const x = globalThis.parseFloat("1.5");',
];

for (const workspace of WORKSPACES) {
  const cwd = fileURLToPath(new URL(`../${workspace}/`, import.meta.url));
  const { ESLint } = createRequire(`${cwd}package.json`)("eslint");
  const eslint = new ESLint({ cwd });
  for (const code of FLOATS) {
    test(`${workspace} bans ${code}`, async () => {
      const [result] = await eslint.lintText(code, { filePath: "src/x.ts" });
      assert.ok(
        result.messages.some((message) =>
          message.message.includes("never a float"),
        ),
        JSON.stringify(result.messages),
      );
    });
  }
}
