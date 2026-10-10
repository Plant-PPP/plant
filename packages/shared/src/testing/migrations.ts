import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Test-only readers of supabase/migrations, so a test can pin the TypeScript
// that mirrors a SQL rule to the rule as last defined. Imported only from
// tests (the TESTING fence in eslint.fences.mjs).
const DIR = join(__dirname, "../../../../supabase/migrations");

export function migrations(): { file: string; sql: string }[] {
  return readdirSync(DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => ({ file, sql: readFileSync(join(DIR, file), "utf8") }));
}

// The body of each private function whose name matches `name`, as the latest
// migration that creates or replaces it defines it.
export function lastFunctionBodies(name: RegExp): Map<string, string> {
  const pattern = new RegExp(
    `CREATE (?:OR REPLACE )?FUNCTION private\\.(?<fn>${name.source})\\(\\)[\\s\\S]*?\\$\\$(?<body>[\\s\\S]*?)\\$\\$`,
    "g",
  );
  const bodies = new Map<string, string>();
  for (const { sql } of migrations()) {
    for (const { groups } of sql.matchAll(pattern)) {
      if (groups?.fn && groups.body) bodies.set(groups.fn, groups.body);
    }
  }
  return bodies;
}

// A table's CREATE TABLE body followed by every later ALTER TABLE on it.
export function tableSql(table: string): string {
  const all = migrations();
  const create = all
    .map(({ sql }) =>
      sql.match(
        new RegExp(`CREATE TABLE public\\.${table} \\(([\\s\\S]*?)\\n\\);`),
      ),
    )
    .find(Boolean);
  if (!create?.[1]) throw new Error(`no CREATE TABLE for ${table}`);
  const alters = all.flatMap(({ sql }) =>
    [
      ...sql.matchAll(
        new RegExp(`ALTER TABLE public\\.${table}\\b[^;]*;`, "g"),
      ),
    ].map(([statement]) => statement),
  );
  return [create[1], ...alters].join("\n");
}

// The parenthesized expression of a named CHECK on a table, as last written.
// No migration yet drops or renames a constraint a test reads; the first one
// that does teaches this reader to follow it.
export function lastConstraint(table: string, name: string): string {
  const sql = tableSql(table);
  const start = sql.lastIndexOf(`CONSTRAINT ${name} CHECK (`);
  if (start < 0) throw new Error(`no CHECK ${name} on ${table}`);
  const open = sql.indexOf("(", start);
  let depth = 0;
  for (let i = open; i < sql.length; i++) {
    if (sql[i] === "(") depth++;
    if (sql[i] === ")" && --depth === 0) return sql.slice(open + 1, i);
  }
  throw new Error(`unbalanced CHECK ${name} on ${table}`);
}
