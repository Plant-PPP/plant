// Cases for scripts/check-migrations.sh, each in a throwaway git repo whose
// `staging` branch holds the merged migrations.
//
//   pnpm test:scripts

import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("./check-migrations.sh", import.meta.url));
const VALID = readFileSync(
  fileURLToPath(
    new URL("./fixtures/squawk/pass-migration-header.sql", import.meta.url),
  ),
  "utf8",
);
const NO_TIMEOUT = "ALTER TABLE public.profiles ADD COLUMN note text;\n";
const MIGRATIONS = "supabase/migrations";
// Two, so the order check has to pick the latest rather than any one.
const MERGED = [
  `${MIGRATIONS}/20260101000000_first.sql`,
  `${MIGRATIONS}/20260105000000_second.sql`,
];

// Runners have no git identity, and a developer's global config may sign
// commits or run hooks. GIT_DIR and friends, set when this runs from a git
// hook, would point every command at the outer repo.
const ENV = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  ),
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

const git = (cwd, ...args) => {
  const r = spawnSync("git", args, { cwd, env: ENV, encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")} failed:\n${r.stderr}`);
  return r.stdout.trim();
};

/** UTC `YYYYMMDDHHMMSS`, `days` from now. */
const version = (days) =>
  new Date(Date.now() + days * 86_400_000)
    .toISOString()
    .replace(/\D/g, "")
    .slice(0, 14);

/**
 * A repo with `merged` on `staging`, then a `feature` branch where `change`
 * edits the tree; returns the script's exit code and output against `base`,
 * or against the base `change` returns.
 */
const check = (change, { base = "staging", merged = MERGED } = {}) => {
  const cwd = mkdtempSync(join(tmpdir(), "check-migrations-"));
  try {
    git(cwd, "init", "-q", "-b", "staging");
    mkdirSync(join(cwd, MIGRATIONS), { recursive: true });
    for (const path of merged) writeFileSync(join(cwd, path), VALID);
    git(cwd, "add", ".");
    git(cwd, "commit", "-q", "-m", "base");
    git(cwd, "checkout", "-q", "-b", "feature");
    const returned = change({
      write: (path, sql = VALID) => writeFileSync(join(cwd, path), sql),
      append: (path, sql) => appendFileSync(join(cwd, path), sql),
      git: (...args) => git(cwd, ...args),
    });
    git(cwd, "add", "-A");
    git(cwd, "commit", "-q", "--allow-empty", "-m", "change");
    const r = spawnSync("bash", [SCRIPT, returned?.base ?? base], {
      cwd,
      env: ENV,
      encoding: "utf8",
    });
    return { code: r.status, output: `${r.stdout}${r.stderr}` };
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
};

test("no new migrations passes", () => {
  assert.equal(check(() => {}).code, 0);
});

test("a new valid migration passes", () => {
  const { code, output } = check(({ write }) =>
    write(`${MIGRATIONS}/20260106000000_new.sql`),
  );
  assert.equal(code, 0, output);
});

test("a version before the latest merged one fails", () => {
  const { code, output } = check(({ write }) =>
    write(`${MIGRATIONS}/20260103000000_between.sql`),
  );
  assert.equal(code, 1);
  assert.match(output, /after the latest one/);
});

test("the same version as the latest merged one fails", () => {
  const { code, output } = check(({ write }) =>
    write(`${MIGRATIONS}/20260105000000_same.sql`),
  );
  assert.equal(code, 1);
  assert.match(output, /after the latest one/);
});

test("a merged migration with an accented name still sets the latest version", () => {
  const { code, output } = check(
    ({ write }) => write(`${MIGRATIONS}/20260201000000_new.sql`),
    { merged: [...MERGED, `${MIGRATIONS}/20260301000000_añadir.sql`] },
  );
  assert.equal(code, 1);
  assert.match(output, /after the latest one in staging \(20260301000000\)/);
});

test("a version more than a day in the future fails", () => {
  const { code, output } = check(({ write }) =>
    write(`${MIGRATIONS}/${version(2)}_future.sql`),
  );
  assert.equal(code, 1);
  assert.match(output, /in the future/);
});

test("a misnamed migration fails", () => {
  const { code, output } = check(({ write }) =>
    write(`${MIGRATIONS}/2026_misnamed.sql`),
  );
  assert.equal(code, 1);
  assert.match(output, /14-digit timestamp/);
});

test("a name squawk would read as a glob fails", () => {
  const { code, output } = check(({ write }) => {
    write(`${MIGRATIONS}/20260106000000_new.sql`);
    write(`${MIGRATIONS}/20260107000000_fix[1].sql`, NO_TIMEOUT);
  });
  assert.equal(code, 1);
  assert.match(output, /14-digit timestamp/);
});

test("a new migration without lock_timeout fails squawk", () => {
  const { code, output } = check(({ write }) =>
    write(`${MIGRATIONS}/20260106000000_no_timeout.sql`, NO_TIMEOUT),
  );
  assert.equal(code, 1);
  assert.match(output, /require-lock-timeout/);
});

// git would otherwise report an unchanged moved file as a rename, which the
// added-files list leaves out.
test("a merged migration moved to another version is checked as new", () => {
  const { code, output } = check(({ git }) =>
    git("mv", MERGED[0], `${MIGRATIONS}/20260104000000_first.sql`),
  );
  assert.equal(code, 1);
  assert.match(output, /after the latest one/);
});

test("an edited merged migration is left to the append-only check", () => {
  const { code, output } = check(({ append }) => append(MERGED[0], NO_TIMEOUT));
  assert.equal(code, 0, output);
});

test("a base with no history in common fails", () => {
  const { code } = check(({ git }) => ({
    base: git(
      "commit-tree",
      git("hash-object", "-w", "-t", "tree", "/dev/null"),
      "-m",
      "unrelated",
    ),
  }));
  assert.notEqual(code, 0);
});

test("the all-zero base of a new branch skips with a warning", () => {
  const { code, output } = check(
    ({ write }) => write(`${MIGRATIONS}/20251231000000_old.sql`),
    { base: "0000000000000000000000000000000000000000" },
  );
  assert.equal(code, 0);
  assert.match(output, /::warning::/);
});

test("an empty base skips with a warning", () => {
  const { code, output } = check(
    ({ write }) => write(`${MIGRATIONS}/20251231000000_old.sql`),
    { base: "" },
  );
  assert.equal(code, 0);
  assert.match(output, /::warning::/);
});
