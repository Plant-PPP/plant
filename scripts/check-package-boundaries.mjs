// Checks the dependencies each workspace manifest declares against the
// package graph: shared is a leaf; sources and core see only shared; jobs
// sees shared, sources and core; only jobs and the web app (the composition
// root) may depend on the Inngest SDK; only the web app and the evals may
// depend on the AI SDK; nothing depends on evals or the security tests. pnpm
// only links declared dependencies, but Node and TypeScript also resolve the
// root node_modules from every package, so the root manifest is checked too.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const allowed = {
  "@plant/shared": [],
  "@plant/sources": ["@plant/shared"],
  "@plant/core": ["@plant/shared"],
  "@plant/jobs": ["@plant/shared", "@plant/sources", "@plant/core"],
  "@plant/web": [
    "@plant/shared",
    "@plant/sources",
    "@plant/core",
    "@plant/jobs",
  ],
  "@plant/evals": ["@plant/shared", "@plant/sources", "@plant/core"],
  "@plant/security-tests": ["@plant/shared"],
  plant: [],
};
// `ai` is fenced with the providers: given a string model id it reaches them
// through the AI Gateway. @inngest/agent-kit calls providers, and
// @inngest/ai's model helpers feed step.ai.
const sdkFences = [
  {
    matches: (dep) => dep === "inngest" || dep.startsWith("@inngest/"),
    allowed: new Set(["@plant/jobs", "@plant/web"]),
    reason: "inngest: steps stay engine-free",
  },
  {
    matches: (dep) =>
      dep === "ai" ||
      dep.startsWith("@ai-sdk/") ||
      /^@inngest\/(ai|agent-kit)$/.test(dep),
    allowed: new Set(["@plant/web", "@plant/evals"]),
    reason:
      "the AI SDK: models are called only from the web app, which records their cost, and the evals",
  },
];
// Every workspace package, from the `packages:` globs in pnpm-workspace.yaml
// (the "dir/*" and plain "dir" forms), so a new one without an entry in
// `allowed` fails.
const root = fileURLToPath(new URL("../", import.meta.url));
const workspaceLines = readFileSync(
  resolve(root, "pnpm-workspace.yaml"),
  "utf8",
).split("\n");
const start = workspaceLines.indexOf("packages:") + 1;
const globs = [];
for (const line of workspaceLines.slice(start)) {
  if (/^\s*(#.*)?$/.test(line)) continue;
  if (/^\S/.test(line)) break; // the next top-level key
  const entry = /^\s+-\s+"?([^"#\s]+)"?\s*(#.*)?$/.exec(line);
  if (!entry) {
    console.error(`Could not parse this pnpm-workspace.yaml entry: ${line}`);
    process.exit(1);
  }
  globs.push(entry[1]);
}
if (start === 0 || globs.length === 0) {
  console.error("Could not read the packages globs in pnpm-workspace.yaml");
  process.exit(1);
}
const manifests = globs.flatMap((glob) => {
  const dirs = glob.endsWith("/*")
    ? readdirSync(resolve(root, glob.slice(0, -2)), {
        withFileTypes: true,
      })
        // pnpm follows a symlinked package; a Dirent reports it as a link.
        .filter((entry) =>
          statSync(resolve(root, glob.slice(0, -2), entry.name), {
            throwIfNoEntry: false,
          })?.isDirectory(),
        )
        .map((entry) => `${glob.slice(0, -2)}/${entry.name}`)
    : [glob];
  for (const dir of dirs) {
    for (const other of ["package.yaml", "package.json5"]) {
      if (existsSync(resolve(root, dir, other))) {
        console.error(`${dir}/${other}: this script reads only package.json`);
        process.exit(1);
      }
    }
  }
  const found = dirs.filter((dir) =>
    existsSync(resolve(root, dir, "package.json")),
  );
  if (found.length === 0) {
    console.error(
      `No package matches "${glob}"; this script only knows "dir/*" and "dir"`,
    );
    process.exit(1);
  }
  return found;
});
manifests.push(".");

// A path dependency must be a workspace package: one anywhere else installs
// its own dependencies, which this script never reads.
const workspaceDirs = new Set(
  manifests.filter((dir) => dir !== ".").map((dir) => resolve(root, dir)),
);

// The package a spec installs when it is not the dependency's key: an alias
// ("npm:ai@6", "workspace:@plant/jobs@*") names it and a path to a workspace
// package ("../jobs", "link:../jobs", "file:../jobs", "workspace:../jobs")
// holds its manifest. undefined for a version range, a tag or "catalog:"; null
// for anything else (a tarball, URL, git spec or a path outside the workspace
// packages), which fails the check.
function installedName(dir, spec) {
  const path =
    /^(?:link|file):(.+)$/.exec(spec)?.[1] ??
    /^workspace:([./].*)$/.exec(spec)?.[1] ??
    // pnpm reads any spec that starts with ".", "/" or "~/" as a path.
    /^((?:\.|\/|~\/).*)$/.exec(spec)?.[1];
  if (path !== undefined) {
    // pnpm resolves "~/" under $HOME, outside the workspace.
    if (path.startsWith("~/")) return null;
    // A path, not a URL: pnpm reads a "%61" in a directory name literally.
    const target = resolve(root, dir, path);
    return workspaceDirs.has(target)
      ? (JSON.parse(readFileSync(resolve(target, "package.json"), "utf8"))
          .name ?? null)
      : null;
  }
  const range = String.raw`[\w.^~<>=|*+ -]*`;
  const name = String.raw`((?:@[\w.~-]+\/)?[\w.~-]+)`;
  const alias = new RegExp(
    `^(?:npm:${name}(?:@${range})?|workspace:${name}@${range})$`,
  )
    .exec(spec)
    ?.slice(1)
    .find(Boolean);
  if (alias !== undefined) return alias;
  if (/\.(tgz|tar|tar\.gz)$/i.test(spec)) return null;
  return new RegExp(`^(?:catalog:|(?:workspace:)?${range}$)`).test(spec)
    ? undefined
    : null;
}

const violations = [];
for (const dir of manifests) {
  const {
    name,
    dependencies = {},
    devDependencies = {},
    peerDependencies = {},
    optionalDependencies = {},
  } = JSON.parse(readFileSync(resolve(root, dir, "package.json"), "utf8"));
  // Field by field: a key in one field must not hide the same key's spec in
  // another, which pnpm may install instead.
  const deps = [
    dependencies,
    devDependencies,
    peerDependencies,
    optionalDependencies,
  ]
    .flatMap((field) => Object.entries(field))
    .flatMap(([key, spec]) => {
      const target = installedName(dir, spec);
      if (target === null) {
        violations.push(
          `${name}: ${key} (${spec}) is not a version, an alias or a workspace package`,
        );
      }
      return target && target !== key
        ? [
            { dep: key, label: key },
            { dep: target, label: `${key} (${target})` },
          ]
        : [{ dep: key, label: key }];
    });
  if (!Object.hasOwn(allowed, name))
    violations.push(`${dir}: unknown package ${name}`);
  for (const { dep, label } of deps) {
    if (
      dep.startsWith("@plant/") &&
      !(Object.hasOwn(allowed, name) && allowed[name].includes(dep))
    ) {
      violations.push(`${name} may not depend on ${label}`);
    }
    for (const fence of sdkFences) {
      if (fence.matches(dep) && !fence.allowed.has(name)) {
        violations.push(`${name} may not depend on ${label}, ${fence.reason}`);
      }
    }
  }
}

if (violations.length > 0) {
  console.error(`Package boundary violations:\n  ${violations.join("\n  ")}`);
  process.exit(1);
}
console.log(`ok: ${manifests.length} manifests respect the package graph`);
