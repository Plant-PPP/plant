// Cases for scripts/check-package-boundaries.mjs, each in a throwaway
// workspace with the same packages as this repo.
//
//   pnpm test:scripts

import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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

/**
 * Runs the script over a workspace where `deps` maps a package name to the
 * dependencies it declares (a name, or a [name, spec] pair), under `field` in
 * every manifest, plus `files` (path to contents) outside the packages.
 */
function check(deps, field = "dependencies", files = {}) {
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
        (deps[name] ?? []).map((dep) =>
          Array.isArray(dep) ? dep : [dep, "*"],
        ),
      );
      writeFileSync(
        join(root, dir, "package.json"),
        JSON.stringify({ name, [field]: dependencies }),
      );
    }
    for (const [path, contents] of Object.entries(files)) {
      mkdirSync(join(root, path, ".."), { recursive: true });
      writeFileSync(join(root, path), contents);
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
    assert.match(
      r.output,
      new RegExp(`${name} may not depend on ${dep}, the AI SDK`),
    );
  });
}

for (const dep of ["inngest", "@inngest/middleware-x"]) {
  test(`${dep} in @plant/core fails`, () => {
    const r = check({ "@plant/core": [dep] });
    assert.equal(r.status, 1);
    assert.match(
      r.output,
      new RegExp(`@plant/core may not depend on ${dep}, inngest`),
    );
  });
}

for (const field of [
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
]) {
  test(`ai in the root's ${field} fails`, () => {
    const r = check({ plant: ["ai"] }, field);
    assert.equal(r.status, 1);
    assert.match(r.output, /plant may not depend on ai, the AI SDK/);
  });
}

for (const [name, alias, message] of [
  [
    "@plant/core",
    ["llm", "npm:ai@6"],
    /@plant\/core may not depend on llm \(ai\), the AI SDK/,
  ],
  [
    "@plant/shared",
    ["gai", "npm:@ai-sdk/google"],
    /@plant\/shared may not depend on gai \(@ai-sdk\/google\), the AI SDK/,
  ],
  [
    "@plant/core",
    ["runner", "workspace:@plant/jobs@*"],
    /@plant\/core may not depend on runner \(@plant\/jobs\)/,
  ],
]) {
  test(`the alias ${alias[0]}: ${alias[1]} in ${name} fails`, () => {
    const r = check({ [name]: [alias] });
    assert.equal(r.status, 1);
    assert.match(r.output, message);
  });
}

for (const spec of ["workspace:*", "workspace:^", "workspace:../jobs"]) {
  test(`@plant/jobs as ${spec} in @plant/core fails`, () => {
    const r = check({ "@plant/core": [["@plant/jobs", spec]] });
    assert.equal(r.status, 1);
    assert.match(r.output, /@plant\/core may not depend on @plant\/jobs$/m);
  });
}

for (const spec of ["workspace:../jobs", "link:../jobs", "file:../jobs"]) {
  test(`runner: ${spec} in @plant/core fails`, () => {
    const r = check({ "@plant/core": [["runner", spec]] });
    assert.equal(r.status, 1);
    assert.match(
      r.output,
      /@plant\/core may not depend on runner \(@plant\/jobs\)/,
    );
  });
}

for (const [spec, label] of [
  ["./vendor/ai", "llm \\(ai\\)"],
  ["../jobs", "llm \\(@plant\\/jobs\\)"],
]) {
  test(`llm: ${spec} in @plant/core fails`, () => {
    const r = check({ "@plant/core": [["llm", spec]] }, "dependencies", {
      "packages/core/vendor/ai/package.json": JSON.stringify({ name: "ai" }),
    });
    assert.equal(r.status, 1);
    assert.match(
      r.output,
      new RegExp(`@plant/core may not depend on ${label}`),
    );
  });
}

test("a path without a leading dot is read", () => {
  const r = check({ plant: [["llm", "link:vendor/ai"]] }, "dependencies", {
    "vendor/ai/package.json": JSON.stringify({ name: "ai" }),
  });
  assert.equal(r.status, 1);
  assert.match(r.output, /plant may not depend on llm \(ai\), the AI SDK/);
});

for (const spec of [
  "link:../missing",
  "file:./vendor/ai-6.0.301.tgz",
  "github:vercel/ai",
  "vercel/ai",
  "https://registry.npmjs.org/ai/-/ai-6.0.301.tgz",
  "git@github.com:vercel/ai.git",
  "vercel/ai#semver:^6",
  "vercel/ai#path:packages/ai",
  "gist:abc123",
  "sourcehut:~x/ai",
  "vendor/x/ai",
  "~/vendor/ai",
  "npm:ai@github:vercel/ai",
]) {
  test(`llm: ${spec} in @plant/core fails`, () => {
    const r = check({ "@plant/core": [["llm", spec]] });
    assert.equal(r.status, 1);
    assert.match(r.output, /cannot tell which package llm \(.*\) installs/);
  });
}

test("a path whose manifest has no name fails", () => {
  const r = check({ plant: [["llm", "link:vendor/ai"]] }, "dependencies", {
    "vendor/ai/package.json": "{}",
  });
  assert.equal(r.status, 1);
  assert.match(r.output, /cannot tell which package llm \(link:vendor\/ai\)/);
});

test("a workspace package the graph does not list fails", () => {
  const r = check({}, "dependencies", {
    "packages/x/package.json": JSON.stringify({ name: "@plant/x" }),
  });
  assert.equal(r.status, 1);
  assert.match(r.output, /packages\/x: unknown package @plant\/x/);
});

test("ai from the catalog in @plant/core fails", () => {
  const r = check({ "@plant/core": [["ai", "catalog:"]] });
  assert.equal(r.status, 1);
  assert.match(r.output, /@plant\/core may not depend on ai, the AI SDK/);
});

test("aliases of the AI SDK where it is allowed pass", () => {
  const r = check({
    "@plant/web": [["llm", "npm:ai@6"]],
    "@plant/evals": [["gai", "npm:@ai-sdk/google"]],
  });
  assert.equal(r.status, 0, r.output);
});

test("the repo's own specs pass", () => {
  const r = check({
    "@plant/web": [
      ["@plant/shared", "workspace:*"],
      ["inngest", "catalog:"],
      ["ai", "^6.0.301"],
      ["runner", "workspace:@plant/jobs@*"],
      ["@plant/core", "workspace:^"],
      ["zod", "4.1.0-beta.1+build || latest"],
    ],
  });
  assert.equal(r.status, 0, r.output);
});
