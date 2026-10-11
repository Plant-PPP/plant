import { readFileSync } from "node:fs";
import { join } from "node:path";

export const repoRoot = join(__dirname, "../../../..");
const config = readFileSync(join(repoRoot, "supabase/config.toml"), "utf8");

// The body of one [table], up to the next table header.
function table(name: string): string {
  const start = config.indexOf(`\n[${name}]\n`);
  if (start === -1) throw new Error(`[${name}] not found`);
  const body = config.slice(start + name.length + 4);
  const end = body.search(/^\[/m);
  return end === -1 ? body : body.slice(0, end);
}

export function value(tableName: string, key: string): string {
  const matches = [
    ...table(tableName).matchAll(new RegExp(`^${key} = (.+)$`, "gm")),
  ];
  expect(matches).toHaveLength(1);
  return (matches[0]?.[1] ?? "").trim();
}

export function tablesUnder(prefix: string): string[] {
  return [...config.matchAll(/^\[([^\]]+)\]$/gm)]
    .map((m) => m[1] ?? "")
    .filter((name) => name.startsWith(`${prefix}.`))
    .map((name) => name.slice(prefix.length + 1));
}
