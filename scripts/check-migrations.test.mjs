// Cases for scripts/check-migrations.sh, each in a throwaway git repo whose
// `staging` branch holds one merged migration.
//
//   pnpm test:scripts

import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import {
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
const MERGED = "supabase/migrations/20260101000000_merged.sql";

// Runners have no git identity, and a developer's global config may sign
// commits or run hooks.
const ENV = {
  ...process.env,
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

/**
 * A repo with MERGED on `staging`, then a `feature` branch where `change`
 * writes files; returns the script's exit code and output against `base`.
 */
const check = (change, base = "staging") => {
  const cwd = mkdtempSync(join(tmpdir(), "check-migrations-"));
  try {
    git(cwd, "init", "-q", "-b", "staging");
    mkdirSync(join(cwd, "supabase/migrations"), { recursive: true });
    writeFileSync(join(cwd, MERGED), VALID);
    git(cwd, "add", ".");
    git(cwd, "commit", "-q", "-m", "base");
    git(cwd, "checkout", "-q", "-b", "feature");
    change((path, sql = VALID) => writeFileSync(join(cwd, path), sql));
    git(cwd, "add", ".");
    git(cwd, "commit", "-q", "--allow-empty", "-m", "change");
    const r = spawnSync("bash", [SCRIPT, base], {
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
  const { code, output } = check((write) =>
    write("supabase/migrations/20260102000000_new.sql"),
  );
  assert.equal(code, 0, output);
});

test("a version at or before the latest merged one fails", () => {
  const { code, output } = check((write) =>
    write("supabase/migrations/20251231000000_old.sql"),
  );
  assert.equal(code, 1);
  assert.match(output, /after the latest one/);
});

test("a version in the future fails", () => {
  const { code, output } = check((write) =>
    write("supabase/migrations/20991231000000_future.sql"),
  );
  assert.equal(code, 1);
  assert.match(output, /in the future/);
});

test("a misnamed migration fails", () => {
  const { code, output } = check((write) =>
    write("supabase/migrations/2026_misnamed.sql"),
  );
  assert.equal(code, 1);
  assert.match(output, /14-digit timestamp/);
});

test("a new migration without lock_timeout fails squawk", () => {
  const { code, output } = check((write) =>
    write(
      "supabase/migrations/20260102000000_no_timeout.sql",
      "ALTER TABLE public.profiles ADD COLUMN note text;\n",
    ),
  );
  assert.equal(code, 1);
  assert.match(output, /require-lock-timeout/);
});

test("the all-zero base of a new branch skips with a warning", () => {
  const { code, output } = check(
    (write) => write("supabase/migrations/20251231000000_old.sql"),
    "0000000000000000000000000000000000000000",
  );
  assert.equal(code, 0);
  assert.match(output, /::warning::/);
});

test("an empty base skips with a warning", () => {
  const { code, output } = check(
    (write) => write("supabase/migrations/20251231000000_old.sql"),
    "",
  );
  assert.equal(code, 0);
  assert.match(output, /::warning::/);
});
