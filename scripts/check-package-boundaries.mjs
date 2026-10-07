// Checks the dependencies each workspace manifest declares against the
// package graph: shared is a leaf; sources and core see only shared; jobs
// sees shared, sources and core; only jobs and the web app (the composition
// root) may depend on the Inngest SDK; nothing depends on evals. pnpm only
// links declared dependencies, so a bare import of anything else fails to
// resolve.
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
};
const engineAllowed = new Set(["@plant/jobs", "@plant/web"]);
// Every workspace package, so a new one without an entry in `allowed` fails.
const root = new URL("../", import.meta.url);
const manifests = [
  ...["apps", "packages"].flatMap((parent) =>
    readdirSync(new URL(`${parent}/`, root), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `${parent}/${entry.name}`),
  ),
  "evals",
].filter((dir) => existsSync(new URL(`${dir}/package.json`, root)));

const violations = [];
for (const dir of manifests) {
  const {
    name,
    dependencies = {},
    devDependencies = {},
    peerDependencies = {},
    optionalDependencies = {},
  } = JSON.parse(
    readFileSync(new URL(`../${dir}/package.json`, import.meta.url), "utf8"),
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
    if (dep === "inngest" && !engineAllowed.has(name)) {
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
