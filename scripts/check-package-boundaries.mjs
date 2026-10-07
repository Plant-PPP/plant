// Checks the dependencies each workspace manifest declares against the
// package graph: shared is a leaf; sources and core see only shared; jobs
// sees shared, sources and core; only jobs and the web app (the composition
// root) may depend on the Inngest SDK; nothing depends on evals. pnpm only
// links declared dependencies, but Node and TypeScript also resolve the root
// node_modules from every package, so the root manifest is checked too.
import { existsSync, readdirSync, readFileSync } from "node:fs";

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
  plant: [],
};
const engineAllowed = new Set(["@plant/jobs", "@plant/web"]);
// Every workspace package, from the `packages:` globs in pnpm-workspace.yaml
// (the "dir/*" and plain "dir" forms), so a new one without an entry in
// `allowed` fails.
const root = new URL("../", import.meta.url);
const workspaceLines = readFileSync(
  new URL("pnpm-workspace.yaml", root),
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
    ? readdirSync(new URL(`${glob.slice(0, -2)}/`, root), {
        withFileTypes: true,
      })
        .filter((entry) => entry.isDirectory())
        .map((entry) => `${glob.slice(0, -2)}/${entry.name}`)
    : [glob];
  const found = dirs.filter((dir) =>
    existsSync(new URL(`${dir}/package.json`, root)),
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

const violations = [];
for (const dir of manifests) {
  const {
    name,
    dependencies = {},
    devDependencies = {},
    peerDependencies = {},
    optionalDependencies = {},
  } = JSON.parse(
    readFileSync(new URL(`${dir}/package.json`, root), "utf8"),
  );
  const deps = Object.keys({
    ...dependencies,
    ...devDependencies,
    ...peerDependencies,
    ...optionalDependencies,
  });
  if (!(name in allowed)) violations.push(`${dir}: unknown package ${name}`);
  for (const dep of deps) {
    if (dep.startsWith("@plant/") && !allowed[name]?.includes(dep)) {
      violations.push(`${name} may not depend on ${dep}`);
    }
    const isEngine = dep === "inngest" || dep.startsWith("@inngest/");
    if (isEngine && !engineAllowed.has(name)) {
      violations.push(
        `${name} may not depend on inngest: steps stay engine-free`,
      );
    }
  }
}

if (violations.length > 0) {
  console.error(`Package boundary violations:\n  ${violations.join("\n  ")}`);
  process.exit(1);
}
console.log(`ok: ${manifests.length} manifests respect the package graph`);
