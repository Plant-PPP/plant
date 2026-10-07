// Cases for scripts/check-migrations.sh, each in a throwaway git repo whose
// `staging` branch holds the merged migrations.
//
//   pnpm test:scripts

import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
 * edits the tree; returns the exit code and output of `script` run from `from`
 * against `base`, or against the base `change` returns; `afterCommit` it
 * returns runs on the repo before the script. `env` adds to ENV.
 */
const check = (
  change,
  {
    base = "staging",
    merged = MERGED,
    from = ".",
    script = SCRIPT,
    env = {},
  } = {},
) => {
  const cwd = mkdtempSync(join(tmpdir(), "check-migrations-"));
  try {
    git(cwd, "init", "-q", "-b", "staging");
    mkdirSync(join(cwd, MIGRATIONS), { recursive: true });
    for (const path of merged) writeFileSync(join(cwd, path), VALID);
    git(cwd, "add", ".");
    git(cwd, "commit", "-q", "--allow-empty", "-m", "base");
    git(cwd, "checkout", "-q", "-b", "feature");
    const returned = change({
      write: (path, sql = VALID) => {
        mkdirSync(dirname(join(cwd, path)), { recursive: true });
        writeFileSync(join(cwd, path), sql);
      },
      append: (path, sql) => appendFileSync(join(cwd, path), sql),
      git: (...args) => git(cwd, ...args),
    });
    git(cwd, "add", "-A");
    git(cwd, "commit", "-q", "--allow-empty", "-m", "change");
    returned?.afterCommit?.(cwd);
    const r = spawnSync("bash", [script, returned?.base ?? base], {
      cwd: join(cwd, from),
      env: { ...ENV, ...env },
      encoding: "utf8",
      timeout: 30_000,
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

test("the first migration passes", () => {
  const { code, output } = check(
    ({ write }) => write(`${MIGRATIONS}/20260106000000_new.sql`),
    { merged: [] },
  );
  assert.equal(code, 0, output);
});

test("a name with uppercase letters and hyphens passes", () => {
  const { code, output } = check(({ write }) =>
    write(`${MIGRATIONS}/20260106000000_Add-Note.sql`),
  );
  assert.equal(code, 0, output);
});

test("a file outside supabase/migrations/ is not checked", () => {
  const { code, output } = check(({ write }) =>
    write("supabase/seed.sql", NO_TIMEOUT),
  );
  assert.equal(code, 0, output);
});

test("every new migration goes through squawk", () => {
  const { code, output } = check(({ write }) => {
    write(`${MIGRATIONS}/20260106000000_a.sql`);
    write(`${MIGRATIONS}/20260107000000_b.sql`, NO_TIMEOUT);
  });
  assert.equal(code, 1);
  assert.match(output, /require-lock-timeout/);
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

test("a version less than a day in the future passes", () => {
  const { code, output } = check(({ write }) =>
    write(`${MIGRATIONS}/${version(0.9)}_soon.sql`),
  );
  assert.equal(code, 0, output);
});

test("a version more than a day in the future fails", () => {
  const { code, output } = check(({ write }) =>
    write(`${MIGRATIONS}/${version(1.1)}_future.sql`),
  );
  assert.equal(code, 1);
  assert.match(output, /in the future/);
});

test("the day of slack is counted in UTC", () => {
  const { code, output } = check(
    ({ write }) => write(`${MIGRATIONS}/${version(1.5)}_future.sql`),
    { env: { TZ: "Etc/GMT-14" } },
  );
  assert.equal(code, 1);
  assert.match(output, /in the future/);
});

test("a version before one merged after the branch point fails", () => {
  const { code, output } = check(({ git, write }) => {
    git("checkout", "-q", "staging");
    write(`${MIGRATIONS}/20260110000000_later.sql`);
    git("add", "-A");
    git("commit", "-q", "-m", "staging moves on");
    git("checkout", "-q", "feature");
    write(`${MIGRATIONS}/20260108000000_new.sql`);
  });
  assert.equal(code, 1);
  assert.match(output, /after the latest one in staging \(20260110000000\)/);
});

test("a migration file the CLI would skip fails", () => {
  for (const name of [
    "20260106000000_new.SQL",
    "20260106000000_new",
    "20260106000000_new.sql.bak",
    "20260106000000_new.sql~",
    "sub/20260106000000_new.sql",
  ]) {
    const { code, output } = check(({ write }) =>
      write(`${MIGRATIONS}/${name}`),
    );
    assert.equal(code, 1, name);
    assert.match(output, /14-digit timestamp/);
  }
});

test("two new migrations with one version fail", () => {
  const { code, output } = check(({ write }) => {
    write(`${MIGRATIONS}/20260106000000_a.sql`);
    write(`${MIGRATIONS}/20260106000000_b.sql`);
  });
  assert.equal(code, 1);
  assert.match(output, /share a version/);
});

test("a migration that opts out of the transaction fails", () => {
  for (const first of [
    "-- pg-delta: transaction=false\n",
    "\uFEFF-- pg-delta: transaction=false\r\n",
  ]) {
    const { code, output } = check(({ write }) =>
      write(`${MIGRATIONS}/20260106000000_new.sql`, `${first}${VALID}`),
    );
    assert.equal(code, 1, JSON.stringify(first));
    assert.match(output, /one transaction/);
  }
});

test("a statement the CLI runs outside the transaction fails beside others", () => {
  for (const statement of [
    "DROP INDEX CONCURRENTLY IF EXISTS public.fixture_runs_user_id_idx;",
    "REINDEX INDEX CONCURRENTLY public.fixture_runs_user_id_idx;",
    "vacuum public.fixture_runs;",
    "CLUSTER public.fixture_runs USING fixture_runs_pkey;",
    "ALTER SYSTEM SET work_mem = '64MB';",
    "PREPARE TRANSACTION 'x';",
  ]) {
    const { code, output } = check(({ write }) =>
      write(`${MIGRATIONS}/20260106000000_new.sql`, `${VALID}\n${statement}\n`),
    );
    assert.equal(code, 1, statement);
    assert.match(output, /all-or-nothing/);
  }
});

test("a lone concurrent index drop passes", () => {
  const { code, output } = check(({ write }) =>
    write(
      `${MIGRATIONS}/20260106000000_drop_index.sql`,
      "-- squawk-ignore require-lock-timeout, require-statement-timeout, prefer-robust-stmts\n" +
        "DROP INDEX CONCURRENTLY IF EXISTS public.fixture_runs_user_id_idx;\n",
    ),
  );
  assert.equal(code, 0, output);
});

test("a file-wide squawk exemption fails", () => {
  const { code, output } = check(({ write }) =>
    write(
      `${MIGRATIONS}/20260106000000_new.sql`,
      `-- squawk-ignore-file\n${NO_TIMEOUT}`,
    ),
  );
  assert.equal(code, 1);
  assert.match(output, /not the whole file/);
});

test("a committed migration missing from the working tree fails", () => {
  const path = `${MIGRATIONS}/20260107000000_gone.sql`;
  const { code, output } = check(({ write }) => {
    write(`${MIGRATIONS}/20260106000000_new.sql`);
    write(path, NO_TIMEOUT);
    return { afterCommit: (cwd) => rmSync(join(cwd, path)) };
  });
  assert.equal(code, 1);
  assert.match(output, /missing from the working tree/);
});

test("a long first line does not slow the check down", () => {
  const started = Date.now();
  const { code, output } = check(({ write }) =>
    write(
      `${MIGRATIONS}/20260106000000_long_line.sql`,
      `-- ${"x".repeat(1_000_000)}\n${VALID}`,
    ),
  );
  assert.equal(code, 0, output);
  assert.ok(Date.now() - started < 10_000);
});

test("errors show accented names as typed", () => {
  const { code, output } = check(({ write }) =>
    write(`${MIGRATIONS}/20260106000000_añadir.sql`),
  );
  assert.equal(code, 1);
  assert.match(output, /20260106000000_añadir\.sql/);
});

test("it checks the whole checkout from a subdirectory", () => {
  const { code, output } = check(
    ({ write }) =>
      write(`${MIGRATIONS}/20260106000000_no_timeout.sql`, NO_TIMEOUT),
    { from: "supabase" },
  );
  assert.equal(code, 1);
  assert.match(output, /require-lock-timeout/);
});

test("a misnamed migration fails", () => {
  for (const name of [
    "2026_misnamed.sql",
    "202601060000000_long.sql",
    "20260106000000_.sql",
  ]) {
    const { code, output } = check(({ write }) =>
      write(`${MIGRATIONS}/${name}`),
    );
    assert.equal(code, 1, name);
    assert.match(output, /14-digit timestamp/);
  }
});

test("a missing squawk fails", () => {
  const dir = mkdtempSync(join(tmpdir(), "check-migrations-script-"));
  try {
    mkdirSync(join(dir, "scripts"));
    copyFileSync(SCRIPT, join(dir, "scripts/check-migrations.sh"));
    const { code, output } = check(
      ({ write }) => write(`${MIGRATIONS}/20260106000000_new.sql`),
      { script: join(dir, "scripts/check-migrations.sh") },
    );
    assert.equal(code, 1);
    assert.match(output, /squawk not found/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a date that cannot compute the limit fails", () => {
  const bin = mkdtempSync(join(tmpdir(), "check-migrations-bin-"));
  try {
    writeFileSync(join(bin, "date"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    const { code, output } = check(
      ({ write }) => write(`${MIGRATIONS}/20260106000000_new.sql`),
      { env: { PATH: `${bin}:${process.env.PATH}` } },
    );
    assert.equal(code, 1);
    assert.match(output, /Could not compute/);
  } finally {
    rmSync(bin, { recursive: true, force: true });
  }
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
  const { code, output } = check(({ git }) => ({
    base: git(
      "commit-tree",
      git("hash-object", "-w", "-t", "tree", "/dev/null"),
      "-m",
      "unrelated",
    ),
  }));
  assert.notEqual(code, 0);
  assert.doesNotMatch(output, /::warning::/);
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
