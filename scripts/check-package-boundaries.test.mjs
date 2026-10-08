// Cases for scripts/check-package-boundaries.mjs, each in a throwaway
// workspace with the same packages as this repo.
//
//   pnpm test:scripts

import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(
  new URL("./check-package-boundaries.mjs", import.meta.url),
);
const PACKAGES = {
  "packages/shared": "@plant/shared",
  "packages/sources": "@plant/sources",
  "packages/core": "@plant/core",
  "packages/jobs": "@plant/jobs",
  "apps/web": "@plant/web",
  evals: "@plant/evals",
  "security-tests": "@plant/security-tests",
  ".": "plant",
};

/** Runs the script over a workspace where `deps` maps a package name to the dependencies it declares. */
function check(deps) {
  const root = mkdtempSync(join(tmpdir(), "boundaries-"));
  try {
    mkdirSync(join(root, "scripts"));
    copyFileSync(SCRIPT, join(root, "scripts/check-package-boundaries.mjs"));
    writeFileSync(
      join(root, "pnpm-workspace.yaml"),
      'packages:\n  - "apps/*"\n  - "packages/*"\n  - "evals"\n  - "security-tests"\n',
    );
    for (const [dir, name] of Object.entries(PACKAGES)) {
      mkdirSync(join(root, dir), { recursive: true });
      const dependencies = Object.fromEntries(
        (deps[name] ?? []).map((dep) => [dep, "*"]),
      );
      writeFileSync(
        join(root, dir, "package.json"),
        JSON.stringify({ name, dependencies }),
      );
    }
    const r = spawnSync(
      process.execPath,
      [join(root, "scripts/check-package-boundaries.mjs")],
      { encoding: "utf8" },
    );
    return { status: r.status, output: r.stdout + r.stderr };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("the SDKs in the packages that own them pass", () => {
  const r = check({
    "@plant/jobs": ["inngest"],
    "@plant/web": ["inngest", "ai", "@ai-sdk/google", "@ai-sdk/anthropic"],
    "@plant/evals": ["ai", "@ai-sdk/google"],
  });
  assert.equal(r.status, 0, r.output);
});

for (const [name, dep] of [
  ["@plant/sources", "@ai-sdk/google"],
  ["@plant/shared", "ai"],
  ["@plant/jobs", "ai"],
  ["plant", "@ai-sdk/anthropic"],
]) {
  test(`${dep} in ${name} fails`, () => {
    const r = check({ [name]: [dep] });
    assert.equal(r.status, 1);
    assert.match(r.output, new RegExp(`${name} may not depend on the AI SDK`));
  });
}

for (const dep of ["inngest", "@inngest/middleware-x"]) {
  test(`${dep} in @plant/core fails`, () => {
    const r = check({ "@plant/core": [dep] });
    assert.equal(r.status, 1);
    assert.match(r.output, /@plant\/core may not depend on inngest/);
  });
}
