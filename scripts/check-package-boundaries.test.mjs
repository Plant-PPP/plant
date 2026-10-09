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
  symlinkSync,
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
 * dependencies it declares (a name, or a [name, spec] or [name, spec, field]
 * entry), under `field` unless the entry names its own, plus `files` (path to
 * contents) outside the packages. `files` may also be a function of the
 * workspace's root.
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
      const manifest = { name };
      for (const dep of deps[name] ?? []) {
        const [key, spec, own = field] = Array.isArray(dep) ? dep : [dep, "*"];
        manifest[own] = { ...manifest[own], [key]: spec };
      }
      writeFileSync(join(root, dir, "package.json"), JSON.stringify(manifest));
    }
    const extra = typeof files === "function" ? files(root) : files;
    for (const [path, contents] of Object.entries(extra)) {
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

test("llm: ../jobs in @plant/core fails", () => {
  const r = check({ "@plant/core": [["llm", "../jobs"]] });
  assert.equal(r.status, 1);
  assert.match(r.output, /@plant\/core may not depend on llm \(@plant\/jobs\)/);
});

test("a path without a leading dot is read", () => {
  const r = check({ plant: [["runner", "link:packages/jobs"]] });
  assert.equal(r.status, 1);
  assert.match(r.output, /plant may not depend on runner \(@plant\/jobs\)/);
});

// A package outside the workspace installs its own dependencies unchecked.
for (const spec of ["./vendor/x", "file:./vendor/x", "link:vendor/x"]) {
  test(`x: ${spec} in @plant/core fails`, () => {
    const r = check({ "@plant/core": [["x", spec]] }, "dependencies", {
      "packages/core/vendor/x/package.json": JSON.stringify({
        name: "x",
        dependencies: { ai: "6.0.301" },
      }),
    });
    assert.equal(r.status, 1);
    assert.match(
      r.output,
      /x \(.*\) is not a version, an alias or a workspace package/,
    );
  });
}

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
  "ai-6.0.301.tgz",
  "ai-6.0.301.tar",
  "ai-6.0.301.tar.gz",
]) {
  test(`llm: ${spec} in @plant/core fails`, () => {
    const r = check({ "@plant/core": [["llm", spec]] });
    assert.equal(r.status, 1);
    assert.match(
      r.output,
      /llm \(.*\) is not a version, an alias or a workspace package/,
    );
  });
}

test("an alias is checked when another field declares the same key", () => {
  const r = check({
    "@plant/core": [
      ["llm", "npm:ai@6", "devDependencies"],
      ["llm", "*", "peerDependencies"],
    ],
  });
  assert.equal(r.status, 1);
  assert.match(r.output, /@plant\/core may not depend on llm \(ai\)/);
});

test("an absolute path is read", () => {
  const r = check({}, "dependencies", (root) => ({
    "package.json": JSON.stringify({
      name: "plant",
      dependencies: { runner: join(root, "packages/jobs") },
    }),
  }));
  assert.equal(r.status, 1);
  assert.match(r.output, /plant may not depend on runner \(@plant\/jobs\)/);
});

test("a path is read as written, not as a URL", () => {
  const r = check(
    { "@plant/jobs": [["s", "link:../%73hared"]] },
    "dependencies",
    { "packages/%73hared/index.js": "" },
  );
  assert.equal(r.status, 1);
  assert.match(r.output, /s \(link:..\/%73hared\) is not a version/);
});

test("an Inngest model package outside the web app fails", () => {
  const r = check({ "@plant/jobs": ["@inngest/agent-kit", "@inngest/ai"] });
  assert.equal(r.status, 1);
  assert.match(
    r.output,
    /@plant\/jobs may not depend on @inngest\/agent-kit, the AI SDK/,
  );
  assert.match(
    r.output,
    /@plant\/jobs may not depend on @inngest\/ai, the AI SDK/,
  );
});

test("an Inngest model package in evals fails", () => {
  const r = check({ "@plant/evals": ["@inngest/ai", "@inngest/agent-kit"] });
  assert.equal(r.status, 1);
  assert.match(
    r.output,
    /@plant\/evals may not depend on @inngest\/ai, inngest/,
  );
  assert.match(
    r.output,
    /@plant\/evals may not depend on @inngest\/agent-kit, inngest/,
  );
});

for (const other of ["package.yaml", "package.json5"]) {
  test(`a workspace package with a ${other} fails`, () => {
    const r = check({}, "dependencies", {
      [`packages/x/${other}`]: "name: llmkit\n",
    });
    assert.equal(r.status, 1);
    assert.match(
      r.output,
      new RegExp(`packages/x/${other}: this script reads only package.json`),
    );
  });
}

test("keys after the packages list are not read as globs", () => {
  const r = check({}, "dependencies", {
    "pnpm-workspace.yaml":
      'packages:\n  - "apps/*"\n  - "packages/*"\n  - "evals"\n  - "security-tests"\ncatalog:\n  - "ai"\n',
  });
  assert.equal(r.status, 0, r.output);
});

test("a workspace glob that matches no package fails", () => {
  const r = check({}, "dependencies", {
    "pnpm-workspace.yaml":
      'packages:\n  - "apps/*"\n  - "packages/*"\n  - "evals"\n  - "security-tests"\n  - "tools/*"\n',
    "tools/.keep": "",
  });
  assert.equal(r.status, 1);
  assert.match(r.output, /No package matches "tools\/\*"/);
});

test("a path whose manifest has no name fails", () => {
  const r = check({ "@plant/core": [["x", "link:../x"]] }, "dependencies", {
    "packages/x/package.json": "{}",
  });
  assert.equal(r.status, 1);
  assert.match(r.output, /x \(link:..\/x\) is not a version/);
});

// pnpm reads a spec that starts with a dot as a path, even with characters a
// version range may hold.
for (const spec of [".v|x", ". v", ".v+x"]) {
  test(`llm: ${spec} in @plant/core fails`, () => {
    const r = check({ "@plant/core": [["llm", spec]] });
    assert.equal(r.status, 1);
    assert.match(
      r.output,
      /llm \(.*\) is not a version, an alias or a workspace package/,
    );
  });
}

test("a flow-style packages list fails", () => {
  const r = check({ "@plant/core": ["ai"] }, "dependencies", {
    "pnpm-workspace.yaml":
      'packages: ["apps/*", "packages/*", "evals", "security-tests"]\n',
  });
  assert.equal(r.status, 1);
  assert.match(r.output, /Could not read the packages globs/);
});

test("a packages list at column 0 fails", () => {
  const r = check({ "@plant/core": ["ai"] }, "dependencies", {
    "pnpm-workspace.yaml":
      'packages:\n- "apps/*"\n- "packages/*"\n- "evals"\n- "security-tests"\n',
  });
  assert.equal(r.status, 1);
  assert.match(r.output, /Could not read the packages globs/);
});

test("comment lines in the packages list are skipped", () => {
  const r = check({}, "dependencies", {
    "pnpm-workspace.yaml":
      'packages:\n  # apps\n  - "apps/*"\n# the rest\n  - "packages/*"\n  - "evals"\n  - "security-tests"\n',
  });
  assert.equal(r.status, 0, r.output);
});

// pnpm resolves "~/" under $HOME, wherever the spec names it.
for (const spec of ["~/../../shared", "file:~/../../shared"]) {
  test(`x: ${spec} in @plant/core fails`, () => {
    const r = check({ "@plant/core": [["x", spec]] });
    assert.equal(r.status, 1);
    assert.match(r.output, /x \(.*\) is not a version/);
  });
}

test("a path to the repo root fails", () => {
  const r = check({ "@plant/core": [["r", "link:../.."]] });
  assert.equal(r.status, 1);
  assert.match(r.output, /r \(link:\.\.\/\.\.\) is not a version/);
});

test("a symlinked workspace package is read", () => {
  const r = check(
    { "@plant/core": [["llmkit", "workspace:*"]] },
    "dependencies",
    (root) => {
      mkdirSync(join(root, "tools/llmkit"), { recursive: true });
      symlinkSync("../tools/llmkit", join(root, "packages/llmkit"));
      return {
        "tools/llmkit/package.json": JSON.stringify({
          name: "llmkit",
          dependencies: { ai: "^6" },
        }),
      };
    },
  );
  assert.equal(r.status, 1);
  assert.match(r.output, /packages\/llmkit: unknown package llmkit/);
  assert.match(r.output, /llmkit may not depend on ai, the AI SDK/);
});

test("a package named after an Object property is unknown", () => {
  const r = check({}, "dependencies", {
    "packages/x/package.json": JSON.stringify({ name: "constructor" }),
  });
  assert.equal(r.status, 1);
  assert.match(r.output, /packages\/x: unknown package constructor/);
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
      ["typescript", ">=5 <7"],
    ],
  });
  assert.equal(r.status, 0, r.output);
});
